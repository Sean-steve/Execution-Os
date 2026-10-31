import {
  AppState,
  TomorrowPlan,
  TomorrowFeasibilityResult,
  TomorrowConflict,
  TomorrowCapacityBreakdown,
  DayActivationResult,
  LateWakeRecoveryResult,
  RoutineTask,
  RoutineState,
  SystemEvent,
} from '../types';
import { IClock, getClockForState, formatMinutesTo12Hour, parseTimeToMinutes } from '../clock';
import { calculateDynamicAllocations } from './allocationEngine';
import { createSystemEvent } from './eventBus';
import { getAutonomousNextAction } from './storageService';
import {
  getAuthoritativeProtectedCommitments,
  reconcileAllocationPlanWithAuthority,
} from './scheduleAuthority';
import {
  evaluateTomorrowFeasibility as evaluateLegacyTomorrowFeasibility,
  activateTomorrowIntent as activateLegacyTomorrowIntent,
  executeLateWakeRecovery as executeLegacyLateWakeRecovery,
} from '../adapters/legacyStandaloneTomorrowPlanningEngine';

function useLegacyStandaloneCompatibility(state?: AppState) {
  return Boolean((state as any)?.legacyStandaloneCompatibility);
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && bStart < aEnd;
}

function preferredWindowStart(window?: string): number {
  switch ((window || '').toUpperCase()) {
    case 'MORNING': return 540;
    case 'MIDDAY': return 720;
    case 'AFTERNOON': return 900;
    case 'EVENING': return 1080;
    default: return 540;
  }
}

function genericActionType(category: string): RoutineTask['interactiveActionType'] {
  if (category === 'DEEP_WORK') return 'FOCUS_BLOCK';
  if (category === 'WORKOUT') return 'WORKOUT_TRACKER';
  if (category === 'MEDITATION') return 'MEDITATION_TIMER';
  return 'GENERIC';
}

/**
 * Domain-neutral feasibility. Whole-person policy belongs to HOS.
 * Legacy standalone behavior exists only behind an explicit test/compatibility flag.
 */
export const evaluateTomorrowFeasibility = (
  plan: TomorrowPlan,
  currentState?: AppState
): TomorrowFeasibilityResult => {
  if (useLegacyStandaloneCompatibility(currentState)) {
    return evaluateLegacyTomorrowFeasibility(plan, currentState);
  }

  const wakeMinutes =
    plan.desiredWakeMinutes ??
    (plan.desiredWakeTime ? parseTimeToMinutes(plan.desiredWakeTime) : undefined) ??
    (plan.wakeTime ? parseTimeToMinutes(plan.wakeTime) : undefined) ??
    0;

  const awakeMinutesAvailable = Math.max(60, 1440 - wakeMinutes);
  const appointments = plan.appointments || [];
  const desiredActivities = plan.desiredActivities || [];

  const hosProtected = currentState ? getAuthoritativeProtectedCommitments(currentState) : [];
  const planProtected = (plan.protectedCommitments || []).map(commitment => ({
    id: commitment.id,
    title: commitment.title,
    startMinutes: commitment.startMinutes,
    endMinutes: commitment.endMinutes,
    isProtected: commitment.isStrict,
  }));
  const protectedCommitments = hosProtected.length ? hosProtected : planProtected;

  const appointmentsMinutes = appointments.reduce(
    (sum, apt) => sum + Math.max(0, apt.endMinutes - apt.startMinutes),
    0
  );
  const customActivitiesMinutes = desiredActivities.reduce(
    (sum, activity) => sum + Math.max(0, activity.durationMinutes),
    0
  );
  const protectedMinutes = protectedCommitments.reduce(
    (sum, commitment) => sum + Math.max(0, commitment.endMinutes - commitment.startMinutes),
    0
  );

  const mandatoryAnchorMinutes = 0;
  const totalCommittedMinutes =
    appointmentsMinutes + customActivitiesMinutes + protectedMinutes;
  const bufferMinutes = awakeMinutesAvailable - totalCommittedMinutes;
  const bufferPercentage = Math.round((bufferMinutes / Math.max(1, awakeMinutesAvailable)) * 100);

  const capacity: TomorrowCapacityBreakdown = {
    awakeMinutesAvailable,
    mandatoryAnchorMinutes,
    customActivitiesMinutes,
    appointmentsMinutes,
    // Deprecated field name retained for API compatibility; value now represents all protected commitments.
    protectedFamilyMinutes: protectedMinutes,
    totalCommittedMinutes,
    bufferMinutes,
    bufferPercentage,
  };

  const conflicts: TomorrowConflict[] = [];

  for (let i = 0; i < appointments.length; i++) {
    for (let j = i + 1; j < appointments.length; j++) {
      const a = appointments[i];
      const b = appointments[j];
      if (rangesOverlap(a.startMinutes, a.endMinutes, b.startMinutes, b.endMinutes)) {
        conflicts.push({
          id: `conflict-appointment-${a.id}-${b.id}`,
          severity: 'CRITICAL',
          message: `Appointment collision: "${a.title}" overlaps "${b.title}".`,
          impactedItemIds: [a.id, b.id],
          resolutionOptions: ['Resolve the conflict in the authoritative planning system.'],
        });
      }
    }
  }

  for (const appointment of appointments) {
    const commitment = protectedCommitments.find(item =>
      item.isProtected &&
      rangesOverlap(appointment.startMinutes, appointment.endMinutes, item.startMinutes, item.endMinutes)
    );
    if (commitment) {
      conflicts.push({
        id: `conflict-protected-${appointment.id}-${commitment.id}`,
        severity: 'CRITICAL',
        message: `"${appointment.title}" conflicts with protected commitment "${commitment.title}".`,
        impactedItemIds: [appointment.id, commitment.id],
        resolutionOptions: ['Resolve in HumanKernelOS / the authoritative schedule owner.'],
      });
    }
  }

  if (bufferMinutes < 0) {
    conflicts.push({
      id: 'conflict-capacity-overload',
      severity: 'CRITICAL',
      message: `The proposed operating plan exceeds available day capacity by ${Math.abs(bufferMinutes)} minutes.`,
      resolutionOptions: ['Reduce load or revise authoritative constraints.'],
    });
  }

  const predictedMode = bufferPercentage >= 20 ? 'GREEN' : bufferPercentage >= 5 ? 'YELLOW' : 'RED';
  const predictedDayType = plan.departureTravelConstraints?.hasDeparture ? 'EARLY_DEPARTURE' : 'STANDARD';
  const predictedRoutineState: RoutineState =
    predictedMode === 'RED' ? 'RECOVERY' : predictedMode === 'YELLOW' ? 'COMPRESSED' : 'STANDARD';
  const score = Math.max(0, Math.min(100, 70 + Math.round(bufferPercentage)));
  const isFeasible = !conflicts.some(c => c.severity === 'CRITICAL');

  return {
    predictedMode,
    predictedDayType,
    predictedRoutineState,
    feasibilityScore: score,
    isFeasible,
    summary: isFeasible
      ? `Feasible execution envelope with ${bufferMinutes} minutes uncommitted.`
      : 'Operating plan has conflicts that must be resolved by the authoritative planning system.',
    capacity,
    conflicts,
  };
};

function buildGenericStandaloneTasks(plan: TomorrowPlan): RoutineTask[] {
  const tasks: RoutineTask[] = [];
  let cursor = plan.desiredWakeMinutes ?? 540;

  for (const appointment of plan.appointments || []) {
    tasks.push({
      id: `task-appointment-${appointment.id}`,
      anchorId: 'ANCHOR_6_OPERATIONS',
      title: appointment.title,
      subtext: appointment.notes,
      timeWindow: `${formatMinutesTo12Hour(appointment.startMinutes)} – ${formatMinutesTo12Hour(appointment.endMinutes)}`,
      startMinutes: appointment.startMinutes,
      endMinutes: appointment.endMinutes,
      isNonNegotiable: true,
      completed: false,
      modesAllowed: ['GREEN', 'YELLOW', 'RED'],
      interactiveActionType: 'GENERIC',
      isProtected: Boolean(appointment.isProtected),
      category: 'APPOINTMENT',
    });
  }

  for (const commitment of plan.protectedCommitments || []) {
    tasks.push({
      id: `task-protected-${commitment.id}`,
      anchorId: 'ANCHOR_6_OPERATIONS',
      title: commitment.title,
      timeWindow: `${formatMinutesTo12Hour(commitment.startMinutes)} – ${formatMinutesTo12Hour(commitment.endMinutes)}`,
      startMinutes: commitment.startMinutes,
      endMinutes: commitment.endMinutes,
      isNonNegotiable: commitment.isStrict,
      completed: false,
      modesAllowed: ['GREEN', 'YELLOW', 'RED'],
      interactiveActionType: 'GENERIC',
      isProtected: commitment.isStrict,
      category: 'PROTECTED_COMMITMENT',
    });
  }

  for (const activity of plan.desiredActivities || []) {
    const preferred = preferredWindowStart(activity.preferredWindow);
    const start = Math.max(cursor, preferred);
    const end = Math.min(1440, start + Math.max(1, activity.durationMinutes));
    tasks.push({
      id: `task-desired-${activity.id}`,
      anchorId: 'ANCHOR_6_OPERATIONS',
      title: activity.title,
      subtext: activity.notes,
      timeWindow: `${formatMinutesTo12Hour(start)} – ${formatMinutesTo12Hour(end)}`,
      startMinutes: start,
      endMinutes: end,
      isNonNegotiable: Boolean(activity.isNonNegotiable),
      completed: false,
      modesAllowed: ['GREEN', 'YELLOW', 'RED'],
      interactiveActionType: genericActionType(activity.category),
      category: activity.category,
    });
    cursor = end + 5;
  }

  return tasks.sort((a, b) => a.startMinutes - b.startMinutes);
}

/**
 * In HOS mode, activation never creates a competing schedule: the HOS Daily Operating Plan is final.
 */
export const activateTomorrowIntent = (
  state: AppState,
  intentOverride?: Partial<TomorrowPlan>,
  clock?: IClock
): { state: AppState; result: DayActivationResult; events: SystemEvent[] } => {
  if (useLegacyStandaloneCompatibility(state)) {
    return activateLegacyTomorrowIntent(state, intentOverride, clock);
  }

  const currentClock = clock || getClockForState(state);

  if (state.scheduleAuthority?.mode === 'HOS' && state.scheduleAuthority.authoritativePlan) {
    const nextAction = getAutonomousNextAction(state);
    const event = createSystemEvent(
      'DayActivated',
      state.scheduleAuthority.authoritativePlan.planId,
      {
        source: 'HOS_DAILY_OPERATING_PLAN',
        planId: state.scheduleAuthority.authoritativePlan.planId,
        planVersion: state.scheduleAuthority.authoritativePlan.planVersion,
      },
      state,
      'SYSTEM_KERNEL',
      undefined,
      currentClock
    );
    const nextState = { ...state, events: [event, ...(state.events || [])].slice(0, 300) };
    return {
      state: nextState,
      result: {
        success: true,
        activatedMode: nextState.currentMode,
        activatedDayType: nextState.dayType,
        activatedRoutineState: nextState.routineState,
        instantiatedTasksCount: nextState.tasks.length,
        nextAction: {
          phaseTitle: nextAction.phaseTitle,
          phaseDesc: nextAction.phaseDesc,
          currentTaskTitle: nextAction.currentTask?.title,
          timeRemainingStr: nextAction.timeRemainingStr,
        },
        allocations: nextState.dynamicAllocations,
        message: 'HOS Daily Operating Plan activated; Execution OS retained bounded execution authority only.',
      },
      events: [event],
    };
  }

  const plan = { ...state.tomorrowPlan, ...(intentOverride || {}) };
  const feasibility = evaluateTomorrowFeasibility(plan, state);
  const tasks = buildGenericStandaloneTasks(plan);
  let nextState: AppState = {
    ...state,
    tasks,
    currentMode: feasibility.predictedMode,
    dayType: feasibility.predictedDayType,
    routineState: feasibility.predictedRoutineState,
  };
  const allocations = calculateDynamicAllocations(nextState);
  nextState = {
    ...nextState,
    dynamicAllocations: allocations.allocations,
    tasks: allocations.recalculatedTasks,
  };
  const nextAction = getAutonomousNextAction(nextState);
  const event = createSystemEvent('DayActivated', 'standalone-plan', {
    source: 'STANDALONE_GENERIC_PLAN',
    taskCount: tasks.length,
  }, nextState, 'SYSTEM_KERNEL', undefined, currentClock);
  nextState.events = [event, ...(nextState.events || [])].slice(0, 300);

  return {
    state: nextState,
    result: {
      success: feasibility.isFeasible,
      activatedMode: nextState.currentMode,
      activatedDayType: nextState.dayType,
      activatedRoutineState: nextState.routineState,
      instantiatedTasksCount: tasks.length,
      nextAction: {
        phaseTitle: nextAction.phaseTitle,
        phaseDesc: nextAction.phaseDesc,
        currentTaskTitle: nextAction.currentTask?.title,
        timeRemainingStr: nextAction.timeRemainingStr,
      },
      allocations: nextState.dynamicAllocations,
      message: 'Generic standalone execution plan activated.',
    },
    events: [event],
  };
};

export const executeLateWakeRecovery = (
  state: AppState,
  actualWakeMinutesOverride?: number,
  clock?: IClock
): { state: AppState; result: LateWakeRecoveryResult; events: SystemEvent[] } => {
  if (useLegacyStandaloneCompatibility(state)) {
    return executeLegacyLateWakeRecovery(state, actualWakeMinutesOverride, clock);
  }

  const currentClock = clock || getClockForState(state);
  const currentMinutes = currentClock.getCurrentTimeMinutes();
  const plannedWake = state.tomorrowPlan.desiredWakeMinutes ?? 0;
  const actualWake = actualWakeMinutesOverride ?? currentMinutes;
  const driftMinutes = Math.max(0, actualWake - plannedWake);
  const material = plannedWake > 0 && driftMinutes >= 20;

  if (!material) {
    const nextAction = getAutonomousNextAction(state);
    return {
      state,
      result: {
        deviationDetected: false,
        plannedWakeMinutes: plannedWake,
        actualWakeMinutes: actualWake,
        driftMinutes,
        compressedRoutineState: state.routineState,
        fallbacksApplied: [],
        reallocatedTasksCount: state.tasks.length,
        departurePreserved: true,
        familyPreserved: true,
        tradingGovernanceStatus: 'ELIGIBLE',
        nextAction: {
          phaseTitle: nextAction.phaseTitle,
          phaseDesc: nextAction.phaseDesc,
          currentTaskTitle: nextAction.currentTask?.title,
          timeRemainingStr: nextAction.timeRemainingStr,
        },
        message: 'No material wake-time deviation detected.',
      },
      events: [],
    };
  }

  const deviation = {
    id: `dev-late-start-${Date.now()}`,
    timestamp: currentClock.toISOString(),
    activityId: state.tasks[0]?.id || 'day-start',
    type: 'LATE' as const,
    severity: driftMinutes > 60 ? ('HIGH' as const) : ('MEDIUM' as const),
    likelyCause: `Actual day start drifted +${driftMinutes}m from the supplied plan.`,
    impactSummary: 'Execution allocation must be recomputed within authoritative schedule boundaries.',
    isResolved: false,
    resolvedAutonomously: false,
  };

  let nextState: AppState = {
    ...state,
    deviations: [deviation, ...(state.deviations || [])],
    routineState: driftMinutes > 90 ? 'DISRUPTED' : 'COMPRESSED',
    routineChangeReason: `Late start +${driftMinutes}m; bounded recovery requested.`,
  };

  const allocation = calculateDynamicAllocations(nextState);
  const authorityDecision = reconcileAllocationPlanWithAuthority(
    nextState,
    allocation.allocations,
    allocation.recalculatedTasks,
    `Late-start recovery (+${driftMinutes}m)`
  );
  nextState = authorityDecision.state;

  const event = createSystemEvent(
    authorityDecision.applied ? 'ScheduleReallocated' : 'ScheduleProposalCreated',
    authorityDecision.proposal?.id || 'late-start-recovery',
    {
      driftMinutes,
      applied: authorityDecision.applied,
      reason: authorityDecision.reason,
    },
    nextState,
    'SYSTEM_KERNEL',
    undefined,
    currentClock
  );
  nextState.events = [event, ...(nextState.events || [])].slice(0, 300);

  const nextAction = getAutonomousNextAction(nextState);
  return {
    state: nextState,
    result: {
      deviationDetected: true,
      plannedWakeMinutes: plannedWake,
      actualWakeMinutes: actualWake,
      driftMinutes,
      compressedRoutineState: nextState.routineState,
      fallbacksApplied: [],
      reallocatedTasksCount: nextState.tasks.length,
      departurePreserved: true,
      // Deprecated compatibility fields below; all protected commitments are now generic/HOS-owned.
      familyPreserved: true,
      tradingGovernanceStatus: 'ELIGIBLE',
      nextAction: {
        phaseTitle: nextAction.phaseTitle,
        phaseDesc: nextAction.phaseDesc,
        currentTaskTitle: nextAction.currentTask?.title,
        timeRemainingStr: nextAction.timeRemainingStr,
      },
      message: authorityDecision.applied
        ? 'Late-start recovery applied inside delegated execution boundaries.'
        : 'Late-start recovery requires HOS approval because the proposal crosses delegated boundaries.',
    },
    events: [event],
  };
};
