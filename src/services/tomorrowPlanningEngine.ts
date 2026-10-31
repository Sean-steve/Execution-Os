import {
  AppState,
  TomorrowPlan,
  TomorrowFeasibilityResult,
  TomorrowConflict,
  TomorrowCapacityBreakdown,
  DayActivationResult,
  LateWakeRecoveryResult,
  RoutineTask,
  DynamicAllocation,
  SystemMode,
  DayType,
  RoutineState,
  SystemEvent
} from '../types';
import { IClock, getClockForState, formatMinutesTo12Hour, parseTimeToMinutes } from '../clock';
import { calculateDynamicAllocations, PROTECTED_FAMILY_START, PROTECTED_FAMILY_END } from './allocationEngine';
import { evaluateRoutineState } from './routineEngine';
import { getFallbackPolicyForTask, selectOptimalFallbackTier } from './fallbackEngine';
import { createSystemEvent } from './eventBus';
import { getAutonomousNextAction } from './storageService';

export const MANDATORY_ANCHORS_BASELINE_MINUTES = 180; // Baseline core anchors (Morning prime, Command center, Lunch, Review)
export const PROTECTED_FAMILY_DURATION_MINUTES = 210;  // 16:00 to 19:30 (3.5 hours)
export const NIGHT_SHUTDOWN_TIME_MINUTES = 1320;      // 22:00 (10:00 PM)

/**
 * Tomorrow Planning Engine
 * First-class engine that computes deterministic feasibility, predicts execution modes,
 * instantiates tomorrow's day from blueprint intent, and executes autonomous late wake recovery.
 */

/**
 * Evaluates whether a proposed Tomorrow Plan fits within daily human and governance limits.
 */
export const evaluateTomorrowFeasibility = (
  plan: TomorrowPlan,
  currentState?: AppState
): TomorrowFeasibilityResult => {
  const wakeMinutes = plan.desiredWakeMinutes || (plan.desiredWakeTime ? parseTimeToMinutes(plan.desiredWakeTime) : (plan.wakeTime ? parseTimeToMinutes(plan.wakeTime) : 330));
  const awakeMinutesAvailable = Math.max(60, NIGHT_SHUTDOWN_TIME_MINUTES - wakeMinutes);

  // 1. Calculate appointment durations
  const appointments = Array.isArray(plan.appointments) ? plan.appointments : [];
  const appointmentsMinutes = appointments.reduce((sum: number, apt: any) => {
    const dur = Math.max(0, (apt?.endMinutes || 0) - (apt?.startMinutes || 0));
    return sum + dur;
  }, 0);

  // 2. Calculate desired activities durations
  const desiredActivities = Array.isArray(plan.desiredActivities) ? plan.desiredActivities : [];
  const customActivitiesMinutes = desiredActivities.reduce((sum: number, act: any) => sum + (act?.durationMinutes || 0), 0);

  // 3. Mandatory anchors duration
  let mandatoryAnchorMinutes = MANDATORY_ANCHORS_BASELINE_MINUTES;
  if (typeof plan.tradingIntention === 'object' && plan.tradingIntention?.isTradingDay) {
    mandatoryAnchorMinutes += 60; // Trading analysis and gatekeeper window
  }

  // 4. Protected family block duration
  const protectedFamilyMinutes = PROTECTED_FAMILY_DURATION_MINUTES;

  // 5. Total committed time & buffer
  const totalCommittedMinutes = mandatoryAnchorMinutes + appointmentsMinutes + customActivitiesMinutes + protectedFamilyMinutes;
  const bufferMinutes = awakeMinutesAvailable - totalCommittedMinutes;
  const bufferPercentage = Math.round((bufferMinutes / awakeMinutesAvailable) * 100);

  const capacity: TomorrowCapacityBreakdown = {
    awakeMinutesAvailable,
    mandatoryAnchorMinutes,
    customActivitiesMinutes,
    appointmentsMinutes,
    protectedFamilyMinutes,
    totalCommittedMinutes,
    bufferMinutes,
    bufferPercentage,
  };

  const conflicts: TomorrowConflict[] = [];

  // Conflict Check A: Overlapping appointments
  for (let i = 0; i < appointments.length; i++) {
    for (let j = i + 1; j < appointments.length; j++) {
      const a = appointments[i];
      const b = appointments[j];
      if (a && b && a.startMinutes !== undefined && b.endMinutes !== undefined && a.startMinutes < b.endMinutes && b.startMinutes < a.endMinutes) {
        conflicts.push({
          id: `conflict-overlap-${a.id || i}-${b.id || j}`,
          severity: 'CRITICAL',
          message: `Appointment collision: "${a.title || 'Meeting'}" (${formatMinutesTo12Hour(a.startMinutes)}-${formatMinutesTo12Hour(a.endMinutes)}) overlaps with "${b.title || 'Meeting'}" (${formatMinutesTo12Hour(b.startMinutes)}-${formatMinutesTo12Hour(b.endMinutes)}).`,
          impactedItemIds: [a.id || `apt-${i}`, b.id || `apt-${j}`],
          resolutionOptions: [
            `Reschedule "${b.title || 'Meeting'}" after ${formatMinutesTo12Hour(a.endMinutes)}`,
            `Compress duration of "${a.title || 'Meeting'}"`,
          ],
        });
      }
    }
  }

  // Conflict Check B: Appointment encroaching into Protected Family Block (16:00 - 19:30)
  for (const apt of appointments) {
    if (apt && apt.startMinutes !== undefined && apt.endMinutes !== undefined && apt.startMinutes < PROTECTED_FAMILY_END && apt.endMinutes > PROTECTED_FAMILY_START) {
      conflicts.push({
        id: `conflict-family-encroachment-${apt.id || 'apt'}`,
        severity: 'CRITICAL',
        message: `Protected Commitment Encroachment: "${apt.title || 'Meeting'}" (${formatMinutesTo12Hour(apt.startMinutes)}-${formatMinutesTo12Hour(apt.endMinutes)}) cuts into the 4:00 PM – 7:30 PM Protected Family Window.`,
        impactedItemIds: [apt.id || 'apt', 'family-block'],
        resolutionOptions: [
          'Move meeting earlier into 10:30 AM - 12:00 PM operational buffer',
          'Shift appointment to post-8:00 PM evening slot',
        ],
      });
    }
  }

  // Conflict Check C: Early Departure constraints
  const departure = plan.departureTravelConstraints;
  if (departure && departure.hasDeparture) {
    const depMinutes = departure.departureMinutes || parseTimeToMinutes(departure.departureTime) || 540;
    const morningPrepAvailable = depMinutes - wakeMinutes - departure.travelBufferMinutes;
    if (morningPrepAvailable < 60) {
      conflicts.push({
        id: 'conflict-departure-prep',
        severity: 'HIGH',
        message: `Early Departure Risk: Departure at ${departure.departureTime} with ${departure.travelBufferMinutes}m buffer leaves only ${morningPrepAvailable}m for morning awakening and breakfast.`,
        resolutionOptions: [
          `Adjust wake time earlier to ${formatMinutesTo12Hour(depMinutes - departure.travelBufferMinutes - 60)}`,
          'Engage Compressed Minimum Viable Morning Prime',
        ],
      });
    }
  }

  // Conflict Check D: Trading window with late wake
  if (plan.tradingIntention?.isTradingDay && wakeMinutes >= 420) { // 7:00 AM or later
    conflicts.push({
      id: 'conflict-trading-prep-window',
      severity: 'HIGH',
      message: 'Trading Governance Warning: Planned wake after 7:00 AM leaves inadequate physiological prep before market open. Protocol requires 45m meditation + identity check before terminal access.',
      resolutionOptions: [
        'Shift desired wake to 5:30 AM',
        'Mark tomorrow as Non-Trading Day to protect capital',
      ],
    });
  }

  // Conflict Check E: Total Capacity Overload
  if (bufferPercentage < 0) {
    conflicts.push({
      id: 'conflict-capacity-overload',
      severity: 'CRITICAL',
      message: `Execution Overcommitment: Total scheduled load (${totalCommittedMinutes}m) exceeds available awake capacity (${awakeMinutesAvailable}m) by ${Math.abs(bufferMinutes)}m.`,
      resolutionOptions: [
        'Prune non-essential custom activities',
        'Limit deep work to 2 focused 90-minute blocks',
        'Engage Yellow Mode (Minimum Viable Routine)',
      ],
    });
  } else if (bufferPercentage < 10) {
    conflicts.push({
      id: 'conflict-capacity-tight',
      severity: 'WARNING',
      message: `Tight Schedule Buffer (${bufferPercentage}% free): Minor delays or unscheduled interruptions will force fallback compression.`,
      resolutionOptions: [
        'Inject a 30m operational pause between deep work and lunch',
      ],
    });
  }

  // Predict System Mode
  let predictedMode: SystemMode = 'GREEN';
  let predictedDayType: DayType = 'STANDARD';
  let predictedRoutineState: RoutineState = 'STANDARD';

  if (plan.specialDayConditions === 'SICK_DAY') {
    predictedMode = 'RED';
    predictedRoutineState = 'RECOVERY';
  } else if (conflicts.some(c => c.severity === 'CRITICAL') || bufferPercentage < 0) {
    predictedMode = 'RED';
    predictedRoutineState = 'COMPRESSED';
  } else if (bufferPercentage < 12 || conflicts.some(c => c.severity === 'HIGH') || plan.specialDayConditions === 'TRAVEL') {
    predictedMode = 'YELLOW';
    predictedRoutineState = 'DISRUPTED';
  } else {
    predictedMode = 'GREEN';
    predictedRoutineState = 'STANDARD';
  }

  if (departure?.hasDeparture || plan.specialDayConditions === 'EARLY_DEPARTURE') {
    predictedDayType = 'EARLY_DEPARTURE';
    predictedRoutineState = 'EARLY_EXIT';
  } else if (plan.specialDayConditions === 'STRONG_ENDS') {
    predictedDayType = 'STRONG_ENDS';
    predictedRoutineState = 'STANDARD';
  }

  // Feasibility Score (0-100)
  let score = 100;
  if (predictedMode === 'RED') {
    score = Math.max(10, 45 + Math.round(bufferPercentage / 2));
  } else if (predictedMode === 'YELLOW') {
    score = Math.max(50, 70 + Math.round(bufferPercentage));
  } else {
    score = Math.min(100, 85 + Math.round(bufferPercentage / 2));
  }
  score = Math.max(0, Math.min(100, score - conflicts.filter(c => c.severity === 'CRITICAL').length * 20));

  const isFeasible = score >= 50 && !conflicts.some(c => c.severity === 'CRITICAL');

  let summary = '';
  if (predictedMode === 'GREEN' && isFeasible) {
    summary = `Pristine Feasibility (${score}/100): Clean ${bufferPercentage}% buffer with protected family window and robust morning anchor sequence.`;
  } else if (predictedMode === 'YELLOW') {
    summary = `Tight Feasibility (${score}/100): System will enforce Minimum Viable Routine compression if schedule drifts.`;
  } else {
    summary = `Critical Overload Detected (${score}/100): Schedule requires human pruning or resolution of conflicting commitments before locking.`;
  }

  return {
    predictedMode,
    predictedDayType,
    predictedRoutineState,
    feasibilityScore: score,
    isFeasible,
    summary,
    capacity,
    conflicts,
  };
};

/**
 * Autonomous Day Activation:
 * Instantiates tomorrow's day by loading intent, evaluating constraints, selecting mode/dayType,
 * generating customized routine tasks & dynamic allocations, and protecting commitments.
 */
export const activateTomorrowIntent = (
  state: AppState,
  intentOverride?: Partial<TomorrowPlan>,
  clock?: IClock
): { state: AppState; result: DayActivationResult; events: SystemEvent[] } => {
  const currentClock = clock || getClockForState(state);
  const plan: TomorrowPlan = {
    ...state.tomorrowPlan,
    ...(intentOverride || {}),
  };

  // At the HumanKernelOS boundary, Execution OS does not create a whole-person
  // daily routine. HOS supplies the Daily Operating Plan; Execution OS only
  // activates and allocates the activities already delegated to it.
  if (state.scheduleAuthority?.mode === 'HOS_DELEGATED') {
    const nextState: AppState = {
      ...state,
      tomorrowPlan: {
        ...plan,
        lastPlannedAt: currentClock.toISOString(),
      },
      routineChangeReason: `Activated under HOS Daily Operating Plan ${state.scheduleAuthority.planId || 'unidentified'}.`,
    };

    const allocation = calculateDynamicAllocations(nextState);
    nextState.dynamicAllocations = allocation.allocations;
    nextState.tasks = allocation.recalculatedTasks;
    if (allocation.scheduleProposal) {
      nextState.pendingScheduleProposals = [
        ...(nextState.pendingScheduleProposals || []).filter(p => p.status === 'PROPOSED'),
        allocation.scheduleProposal,
      ];
    }

    const nextAction = getAutonomousNextAction(nextState);
    const event = createSystemEvent(
      'DayActivated',
      state.scheduleAuthority.planId || 'hos-daily-operating-plan',
      {
        authority: 'HOS',
        planId: state.scheduleAuthority.planId,
        planRevision: state.scheduleAuthority.planRevision,
        delegatedActivitiesCount: nextState.tasks.length,
        proposedScheduleChanges: allocation.proposedChangesCount || 0,
      },
      nextState,
      'SYSTEM_KERNEL',
      undefined,
      currentClock
    );
    nextState.events = [event, ...(nextState.events || [])].slice(0, 300);

    return {
      state: nextState,
      result: {
        success: true,
        activatedMode: nextState.currentMode,
        activatedDayType: nextState.dayType,
        activatedRoutineState: nextState.routineState,
        instantiatedTasksCount: 0,
        nextAction: {
          phaseTitle: nextAction.phaseTitle,
          phaseDesc: nextAction.phaseDesc,
          currentTaskTitle: nextAction.currentTask?.title,
          timeRemainingStr: nextAction.timeRemainingStr,
        },
        allocations: nextState.dynamicAllocations,
        message: 'HOS Daily Operating Plan retained as final schedule authority; delegated execution activated.',
      },
      events: [event],
    };
  }

  // 1. Evaluate feasibility of intent
  const feasibility = evaluateTomorrowFeasibility(plan, state);

  const targetMode = feasibility.predictedMode;
  const targetDayType = feasibility.predictedDayType;
  const wakeMinutes = plan.desiredWakeMinutes || parseTimeToMinutes(plan.desiredWakeTime) || 330;

  // 2. Build instantiated Routine Tasks for Tomorrow
  const instantiatedTasks: RoutineTask[] = [];

  // Anchor 1: Awakening & Self
  instantiatedTasks.push({
    id: 'task-awaken-self',
    anchorId: 'ANCHOR_1_AWAKEN',
    title: 'Awaken & Identity Anchor (Consciousness Reset)',
    subtext: 'No phone. Dream clarity reflection, physical grounding, state presence.',
    timeWindow: `${formatMinutesTo12Hour(wakeMinutes)} – ${formatMinutesTo12Hour(wakeMinutes + 20)}`,
    startMinutes: wakeMinutes,
    endMinutes: wakeMinutes + 20,
    isNonNegotiable: true,
    completed: false,
    modesAllowed: ['GREEN', 'YELLOW', 'RED'],
    interactiveActionType: 'IDENTITY_CHECK',
    associatedPillar: 'morning',
  });

  // Anchor 2: Light & Hydration
  instantiatedTasks.push({
    id: 'task-outdoor-light',
    anchorId: 'ANCHOR_2_PRIME',
    title: 'Hydration & Sunlight Protocol',
    subtext: '500ml water + electrolytes. Natural outdoor sky view for circadian lock.',
    timeWindow: `${formatMinutesTo12Hour(wakeMinutes + 20)} – ${formatMinutesTo12Hour(wakeMinutes + 40)}`,
    startMinutes: wakeMinutes + 20,
    endMinutes: wakeMinutes + 40,
    isNonNegotiable: true,
    completed: false,
    modesAllowed: ['GREEN', 'YELLOW', 'RED'],
    interactiveActionType: 'OUTSIDE_TIMER',
    associatedPillar: 'morning',
  });

  // Anchor 3: Movement & Shower
  instantiatedTasks.push({
    id: 'task-morning-workout',
    anchorId: 'ANCHOR_2_PRIME',
    title: plan.workoutType ? `Morning Physical Prime (${plan.workoutType})` : 'Morning Movement & Shower',
    subtext: 'Calisthenics, mobility sets, cold-rinse finish. Awaken physical vessel.',
    timeWindow: `${formatMinutesTo12Hour(wakeMinutes + 40)} – ${formatMinutesTo12Hour(wakeMinutes + 65)}`,
    startMinutes: wakeMinutes + 40,
    endMinutes: wakeMinutes + 65,
    isNonNegotiable: false,
    completed: false,
    modesAllowed: ['GREEN', 'YELLOW'],
    interactiveActionType: 'WORKOUT_TRACKER',
    associatedPillar: 'body',
  });

  // Anchor 4: Meditation & Stillness
  instantiatedTasks.push({
    id: 'task-meditation',
    anchorId: 'ANCHOR_2_PRIME',
    title: 'Meditation & Stillness (Unfragmented Mind)',
    subtext: 'Silent awareness. Observe thoughts, eliminate mental friction before screens.',
    timeWindow: `${formatMinutesTo12Hour(wakeMinutes + 65)} – ${formatMinutesTo12Hour(wakeMinutes + 90)}`,
    startMinutes: wakeMinutes + 65,
    endMinutes: wakeMinutes + 90,
    isNonNegotiable: true,
    completed: false,
    modesAllowed: ['GREEN', 'YELLOW', 'RED'],
    interactiveActionType: 'MEDITATION_TIMER',
    associatedPillar: 'morning',
  });

  // Optional: Trading Gatekeeper (if trading day)
  let tradingCursor = wakeMinutes + 90;
  if (plan.tradingIntention?.isTradingDay) {
    instantiatedTasks.push({
      id: 'task-trading-protocol',
      anchorId: 'ANCHOR_3_COMMAND',
      title: 'Wealth / Trading Protocol & Gatekeeper Check',
      subtext: plan.tradingIntention.setupFocus || 'Market analysis, risk limits verification, setup qualification.',
      timeWindow: `${formatMinutesTo12Hour(tradingCursor)} – ${formatMinutesTo12Hour(tradingCursor + 30)}`,
      startMinutes: tradingCursor,
      endMinutes: tradingCursor + 30,
      isNonNegotiable: true,
      completed: false,
      modesAllowed: ['GREEN', 'YELLOW'],
      interactiveActionType: 'TRADING_GATEKEEPER',
      associatedPillar: 'wealthTrading',
    });
    tradingCursor += 30;
  }

  // Anchor 5: Command Center & Breakfast
  const commandCenterStart = Math.max(410, tradingCursor);
  instantiatedTasks.push({
    id: 'task-command-center',
    anchorId: 'ANCHOR_3_COMMAND',
    title: 'Command Center: 10 PM Victory Question',
    subtext: plan.definitionOfVictory ? `Victory Goal: ${plan.definitionOfVictory}` : 'Lock the single standard of victory for 10 PM. Review Top 3.',
    timeWindow: `${formatMinutesTo12Hour(commandCenterStart)} – ${formatMinutesTo12Hour(commandCenterStart + 25)}`,
    startMinutes: commandCenterStart,
    endMinutes: commandCenterStart + 25,
    isNonNegotiable: true,
    completed: false,
    modesAllowed: ['GREEN', 'YELLOW', 'RED'],
    interactiveActionType: 'COMMAND_CENTER',
    associatedPillar: 'mission',
  });

  instantiatedTasks.push({
    id: 'task-breakfast',
    anchorId: 'ANCHOR_4_BREAKFAST',
    title: 'High-Protein Breakfast & Mindful Fuel',
    subtext: plan.plannedMeal || 'Nourish without distraction or social media feeds.',
    timeWindow: `${formatMinutesTo12Hour(commandCenterStart + 25)} – ${formatMinutesTo12Hour(commandCenterStart + 55)}`,
    startMinutes: commandCenterStart + 25,
    endMinutes: commandCenterStart + 55,
    isNonNegotiable: false,
    completed: false,
    modesAllowed: ['GREEN', 'YELLOW', 'RED'],
    interactiveActionType: 'GENERIC',
    associatedPillar: 'body',
  });

  // Anchor 6: Deep Work Battlefield
  const deepWorkStart = commandCenterStart + 55;
  const deepWorkDuration = targetDayType === 'EARLY_DEPARTURE' ? 90 : 150;
  const top1Title = plan.top3?.[0] || 'Core System Infrastructure Build';

  instantiatedTasks.push({
    id: 'task-deep-work-build',
    anchorId: 'ANCHOR_5_DEEPWORK_BUILD',
    title: `Deep Work Battlefield: ${top1Title}`,
    subtext: 'Primary build mission. Blockers active, phone away, continuous flow.',
    timeWindow: `${formatMinutesTo12Hour(deepWorkStart)} – ${formatMinutesTo12Hour(deepWorkStart + deepWorkDuration)}`,
    startMinutes: deepWorkStart,
    endMinutes: deepWorkStart + deepWorkDuration,
    isNonNegotiable: true,
    completed: false,
    modesAllowed: ['GREEN', 'YELLOW'],
    interactiveActionType: 'FOCUS_BLOCK',
    associatedPillar: 'mission',
  });

  // Fixed Appointments injected
  for (const apt of plan.appointments || []) {
    instantiatedTasks.push({
      id: `task-appointment-${apt.id}`,
      anchorId: 'ANCHOR_6_OPERATIONS',
      title: `Appointment: ${apt.title}`,
      subtext: apt.notes || (apt.location ? `Location: ${apt.location}` : 'Scheduled commitment'),
      timeWindow: `${formatMinutesTo12Hour(apt.startMinutes)} – ${formatMinutesTo12Hour(apt.endMinutes)}`,
      startMinutes: apt.startMinutes,
      endMinutes: apt.endMinutes,
      isNonNegotiable: true,
      completed: false,
      modesAllowed: ['GREEN', 'YELLOW', 'RED'],
      interactiveActionType: 'GENERIC',
      associatedPillar: 'business',
      isProtected: true,
    });
  }

  // Anchor 7: Lunch & Company of the Day
  instantiatedTasks.push({
    id: 'task-lunch',
    anchorId: 'ANCHOR_7_EXECUTE_LUNCH',
    title: 'Lunch & Deliberate Physical Pause',
    subtext: 'Mindful refuel, step away from screens.',
    timeWindow: '12:00 PM – 12:30 PM',
    startMinutes: 720,
    endMinutes: 750,
    isNonNegotiable: true,
    completed: false,
    modesAllowed: ['GREEN', 'YELLOW', 'RED'],
    interactiveActionType: 'GENERIC',
    associatedPillar: 'body',
  });

  const companyName = plan.companyPriorities?.companyName || plan.companyPriority || 'Company of the Day';
  instantiatedTasks.push({
    id: 'task-company-of-day',
    anchorId: 'ANCHOR_7_EXECUTE_LUNCH',
    title: `Company of the Day: ${companyName}`,
    subtext: plan.companyPriorities?.objective || 'Target single designated venture. Complete 3 discrete micro-actions.',
    timeWindow: '12:30 PM – 2:30 PM',
    startMinutes: 750,
    endMinutes: 870,
    isNonNegotiable: true,
    completed: false,
    modesAllowed: ['GREEN', 'YELLOW'],
    interactiveActionType: 'COMPANY_TARGET',
    associatedPillar: 'business',
  });

  // Anchor 8: Human Life & Family (16:00 - 19:30 Protected)
  instantiatedTasks.push({
    id: 'task-family-connection',
    anchorId: 'ANCHOR_8_HUMAN_LIFE',
    title: `Protected Family Time: ${plan.familyCommitments?.activity || plan.familyActivity || 'Dedicated Family Outing & Connection'}`,
    subtext: 'Unhurried presence, conversation, baby & family connection. Strict zero-work sanctuary.',
    timeWindow: '4:00 PM – 7:30 PM',
    startMinutes: PROTECTED_FAMILY_START,
    endMinutes: PROTECTED_FAMILY_END,
    isNonNegotiable: true,
    completed: false,
    modesAllowed: ['GREEN', 'YELLOW', 'RED'],
    interactiveActionType: 'FAMILY_OUTING',
    associatedPillar: 'family',
    isProtected: true,
  });

  // Anchor 9: Dinner & Human Connection
  instantiatedTasks.push({
    id: 'task-dinner-family',
    anchorId: 'ANCHOR_9_CONNECT',
    title: 'Family Dinner & Nourishment',
    subtext: 'Shared meal, mindful transition completely out of builder mode.',
    timeWindow: '7:30 PM – 8:00 PM',
    startMinutes: 1170,
    endMinutes: 1200,
    isNonNegotiable: true,
    completed: false,
    modesAllowed: ['GREEN', 'YELLOW', 'RED'],
    interactiveActionType: 'GENERIC',
    associatedPillar: 'family',
    isProtected: true,
  });

  // Anchor 10: Evening Review & Tomorrow Blueprint
  instantiatedTasks.push({
    id: 'task-daily-analysis',
    anchorId: 'ANCHOR_10_REVIEW',
    title: 'Daily Analysis & 7 Pillars Score',
    subtext: 'Score 7 Pillars, complete 6 reflection questions, lock victory.',
    timeWindow: '8:00 PM – 8:30 PM',
    startMinutes: 1200,
    endMinutes: 1230,
    isNonNegotiable: true,
    completed: false,
    modesAllowed: ['GREEN', 'YELLOW', 'RED'],
    interactiveActionType: 'GENERIC',
    associatedPillar: 'eveningShutdown',
  });

  instantiatedTasks.push({
    id: 'task-tomorrow-plan',
    anchorId: 'ANCHOR_10_REVIEW',
    title: "Tomorrow's Blueprint Planning",
    subtext: 'Pre-compute tomorrow before sleeping. Eliminate morning cognitive fatigue.',
    timeWindow: '8:30 PM – 9:00 PM',
    startMinutes: 1230,
    endMinutes: 1260,
    isNonNegotiable: true,
    completed: false,
    modesAllowed: ['GREEN', 'YELLOW', 'RED'],
    interactiveActionType: 'GENERIC',
    associatedPillar: 'eveningShutdown',
  });

  // Anchor 12: Night Shutdown
  instantiatedTasks.push({
    id: 'task-night-shutdown',
    anchorId: 'ANCHOR_12_SHUTDOWN',
    title: 'Anchor 12: Night Shutdown (Sleep Phase)',
    subtext: 'Screens off, dark room, 68°F. Deep biological restoration.',
    timeWindow: '10:00 PM+',
    startMinutes: 1320,
    endMinutes: 1440,
    isNonNegotiable: true,
    completed: false,
    modesAllowed: ['GREEN', 'YELLOW', 'RED'],
    interactiveActionType: 'GENERIC',
    associatedPillar: 'eveningShutdown',
  });

  // Sort instantiated tasks chronologically
  instantiatedTasks.sort((a, b) => a.startMinutes - b.startMinutes);

  // 3. Assemble new AppState
  const nextCompanyActions = plan.companyPriorities?.actions?.map((text, idx) => ({
    id: `act-tomorrow-${idx + 1}`,
    text,
    done: false,
  })) || state.companyOfTheDay.actions.map(a => ({ ...a, done: false }));

  const nextTradingProtocol = {
    ...state.tradingProtocol,
    isTradingDay: plan.tradingIntention?.isTradingDay ?? true,
    marketAnalyzed: false,
    setupDetected: false,
    setupName: plan.tradingIntention?.setupFocus || '',
    strategyCriteriaMet: false,
    riskLimitsSatisfied: false,
    stopLossDefined: false,
    executed: false,
    tradeNotes: '',
    closedTerminal: false,
    noSetupJustified: false,
  };

  const nextState: AppState = {
    ...state,
    currentMode: targetMode,
    dayType: targetDayType,
    routineState: feasibility.predictedRoutineState,
    routineChangeReason: `Activated from Tomorrow Blueprint: ${feasibility.summary}`,
    tasks: instantiatedTasks,
    victoryQuestionAnswer: plan.definitionOfVictory || plan.top3[0] || state.victoryQuestionAnswer,
    companyOfTheDay: {
      companyName: plan.companyPriorities?.companyName || plan.companyPriority || state.companyOfTheDay.companyName,
      objective: plan.companyPriorities?.objective || state.companyOfTheDay.objective,
      targetOutcome: plan.top3[0] || state.companyOfTheDay.targetOutcome,
      actions: nextCompanyActions,
    },
    tradingProtocol: nextTradingProtocol,
    identityStatus: {
      rememberedDream: false,
      rememberedWho: false,
      rememberedWhere: false,
      rememberedWhatBuilding: false,
      completedToday: false,
    },
    morningWorkoutSetsDone: 0,
    afternoonWorkoutSetsDone: 0,
    morningOutdoorMinutes: 0,
    meditationMinutes: 0,
    pointsAwardedTasks: [],
    disciplinePenaltiesCount: 0,
    tomorrowPlan: {
      ...plan,
      lastPlannedAt: currentClock.toISOString(),
      lastFeasibilityResult: feasibility,
    },
  };

  // 4. Calculate Dynamic Allocations for the activated day
  const allocResult = calculateDynamicAllocations(nextState);
  nextState.dynamicAllocations = allocResult.allocations;
  nextState.tasks = allocResult.recalculatedTasks;

  const nextAction = getAutonomousNextAction(nextState);

  // 5. Generate Durable Events
  const events: SystemEvent[] = [];

  const evtTomorrow = createSystemEvent(
    'TomorrowActivated',
    'dayPlan',
    {
      planSummary: plan.definitionOfVictory || plan.top3[0],
      mode: targetMode,
      dayType: targetDayType,
      feasibilityScore: feasibility.feasibilityScore,
      instantiatedTasksCount: nextState.tasks.length,
      allocationsCount: nextState.dynamicAllocations.length,
    },
    nextState,
    'SYSTEM_KERNEL',
    undefined,
    currentClock
  );
  events.push(evtTomorrow);

  const evtRoutine = createSystemEvent(
    'RoutineActivated',
    'dailySchedule',
    {
      routineState: nextState.routineState,
      mode: targetMode,
      dayType: targetDayType,
      reason: feasibility.summary,
    },
    nextState,
    'SYSTEM_KERNEL',
    evtTomorrow.event_id,
    currentClock
  );
  events.push(evtRoutine);

  nextState.events = [...events, ...(state.events || [])].slice(0, 300);

  const result: DayActivationResult = {
    success: true,
    activatedMode: targetMode,
    activatedDayType: targetDayType,
    activatedRoutineState: nextState.routineState,
    instantiatedTasksCount: nextState.tasks.length,
    nextAction: {
      phaseTitle: nextAction.phaseTitle,
      phaseDesc: nextAction.phaseDesc,
      currentTaskTitle: nextAction.currentTask?.title,
      timeRemainingStr: nextAction.timeRemainingStr,
    },
    allocations: nextState.dynamicAllocations,
    message: `Autonomous Day Activation complete. Mode: ${targetMode}, Routine: ${nextState.routineState}. ${nextState.tasks.length} anchors instantiated.`,
  };

  return {
    state: nextState,
    result,
    events,
  };
};

/**
 * Late Wake Recovery Engine:
 * When actual wake differs materially from planned wake time, automatically detects deviation,
 * reassesses capacity, compresses morning routine via fallback tiers, reallocates schedule,
 * strictly preserves departures and protected family time, and audits trading governance.
 */
export const executeLateWakeRecovery = (
  state: AppState,
  actualWakeMinutesOverride?: number,
  clock?: IClock
): { state: AppState; result: LateWakeRecoveryResult; events: SystemEvent[] } => {
  const currentClock = clock || getClockForState(state);
  const currentMinutes = currentClock.getCurrentTimeMinutes();
  const plannedWake = state.tomorrowPlan.desiredWakeMinutes || 330; // 5:30 AM
  const actualWake = actualWakeMinutesOverride !== undefined ? actualWakeMinutesOverride : currentMinutes;

  const driftMinutes = actualWake - plannedWake;
  const isMaterialDeviation = driftMinutes >= 20;

  const events: SystemEvent[] = [];
  const fallbacksApplied: LateWakeRecoveryResult['fallbacksApplied'] = [];

  let nextState = { ...state };

  if (state.scheduleAuthority?.mode === 'HOS_DELEGATED' && isMaterialDeviation) {
    const devId = `dev-schedule-drift-${Date.now()}`;
    const deviation = {
      id: devId,
      timestamp: currentClock.toISOString(),
      activityId: 'day-schedule',
      type: 'LATE' as const,
      severity: driftMinutes > 60 ? ('HIGH' as const) : ('MEDIUM' as const),
      minutesDelayed: driftMinutes,
      likelyCause: `Observed execution start drifted +${driftMinutes}m from the HOS Daily Operating Plan.`,
      impactSummary: 'Execution OS recalculated delegated activities without changing host-owned schedule boundaries.',
      isResolved: false,
      resolvedAutonomously: false,
    };
    nextState.deviations = [deviation, ...(nextState.deviations || [])];

    const allocation = calculateDynamicAllocations(nextState);
    nextState.dynamicAllocations = allocation.allocations;
    nextState.tasks = allocation.recalculatedTasks;
    if (allocation.scheduleProposal) {
      nextState.pendingScheduleProposals = [
        ...(nextState.pendingScheduleProposals || []).filter(p => p.status === 'PROPOSED'),
        allocation.scheduleProposal,
      ];
    }

    const event = createSystemEvent(
      allocation.scheduleProposal ? 'ScheduleChangeProposed' : 'ScheduleReallocated',
      allocation.scheduleProposal?.id || 'dynamicAllocations',
      {
        authority: 'HOS',
        driftMinutes,
        planId: state.scheduleAuthority.planId,
        planRevision: state.scheduleAuthority.planRevision,
        proposedChanges: allocation.proposedChangesCount || 0,
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
        familyPreserved: true,
        tradingGovernanceStatus: 'ELIGIBLE',
        nextAction: {
          phaseTitle: nextAction.phaseTitle,
          phaseDesc: nextAction.phaseDesc,
          currentTaskTitle: nextAction.currentTask?.title,
          timeRemainingStr: nextAction.timeRemainingStr,
        },
        message: allocation.scheduleProposal
          ? 'Execution drift detected; host schedule change proposed to HOS and Daily Operating Plan retained.'
          : 'Execution drift recovered autonomously inside HOS-approved execution boundaries.',
      },
      events: [event],
    };
  }

  if (!isMaterialDeviation) {
    const nextAction = getAutonomousNextAction(nextState);
    return {
      state: nextState,
      result: {
        deviationDetected: false,
        plannedWakeMinutes: plannedWake,
        actualWakeMinutes: actualWake,
        driftMinutes,
        compressedRoutineState: nextState.routineState,
        fallbacksApplied: [],
        reallocatedTasksCount: nextState.tasks.length,
        departurePreserved: true,
        familyPreserved: true,
        tradingGovernanceStatus: 'ELIGIBLE',
        nextAction: {
          phaseTitle: nextAction.phaseTitle,
          phaseDesc: nextAction.phaseDesc,
          currentTaskTitle: nextAction.currentTask?.title,
          timeRemainingStr: nextAction.timeRemainingStr,
        },
        message: `Wake time (${formatMinutesTo12Hour(actualWake)}) is within acceptable ±20m buffer of planned ${formatMinutesTo12Hour(plannedWake)}. Nominal schedule retained.`,
      },
      events: [],
    };
  }

  // 1. Log Deviation Record
  const devId = `dev-late-wake-${Date.now()}`;
  const devRecord = {
    id: devId,
    timestamp: currentClock.toISOString(),
    activityId: 'task-awaken-self',
    type: 'LATE' as const,
    severity: driftMinutes > 60 ? ('HIGH' as const) : ('MEDIUM' as const),
    likelyCause: `Actual wake time ${formatMinutesTo12Hour(actualWake)} drifted +${driftMinutes}m past planned wake (${formatMinutesTo12Hour(plannedWake)}).`,
    impactSummary: 'Morning prime window compressed. Fallbacks engaged to protect Deep Work and 4:00 PM Family block.',
    isResolved: true,
    resolvedAutonomously: true,
  };

  nextState.deviations = [devRecord, ...(nextState.deviations || [])];

  const evtDev = createSystemEvent(
    'DeviationDetected',
    'task-awaken-self',
    {
      deviationType: 'LATE',
      driftMinutes,
      plannedWake: formatMinutesTo12Hour(plannedWake),
      actualWake: formatMinutesTo12Hour(actualWake),
    },
    nextState,
    'SYSTEM_KERNEL',
    undefined,
    currentClock
  );
  events.push(evtDev);

  // 2. Compress Routine State
  const targetRoutineState: RoutineState = driftMinutes > 90 ? 'DISRUPTED' : 'COMPRESSED';
  nextState.routineState = targetRoutineState;
  nextState.routineChangeReason = `Late wake deviation (+${driftMinutes}m). Routine compressed into rapid morning prime.`;

  const evtRoutine = createSystemEvent(
    'RoutineStateTransitioned',
    'dailySchedule',
    {
      fromState: state.routineState,
      toState: targetRoutineState,
      driftMinutes,
    },
    nextState,
    'SYSTEM_KERNEL',
    evtDev.event_id,
    currentClock
  );
  events.push(evtRoutine);

  // 3. Apply Fallback Policies to flexible morning tasks
  nextState.tasks = nextState.tasks.map(task => {
    if (task.completed) return task;

    // Apply Tier 1 Fallback to meditation (30m -> 5m)
    if (task.id === 'task-meditation') {
      fallbacksApplied.push({
        taskId: task.id,
        taskTitle: task.title,
        tierLevel: 1,
        originalDuration: 25,
        newDuration: 5,
      });
      return {
        ...task,
        subtext: 'Compressed Stillness (5m focus breathing reset)',
        fallbackLevel: 1,
      };
    }

    // Apply Tier 1 Fallback to workout (25m -> 10m power mobility)
    if (task.id === 'task-morning-workout') {
      fallbacksApplied.push({
        taskId: task.id,
        taskTitle: task.title,
        tierLevel: 1,
        originalDuration: 25,
        newDuration: 10,
      });
      return {
        ...task,
        subtext: 'Rapid Mobility & Cold Finish (10m)',
        fallbackLevel: 1,
      };
    }

    return task;
  });

  // 4. Audit Trading Governance
  let tradingStatus: 'ELIGIBLE' | 'REQUIRES_PREP' | 'SUSPENDED' = 'ELIGIBLE';
  if (nextState.tradingProtocol.isTradingDay) {
    if (actualWake >= 480) { // 8:00 AM or later
      tradingStatus = 'SUSPENDED';
      nextState.tradingProtocol = {
        ...nextState.tradingProtocol,
        noSetupJustified: true,
        tradeNotes: 'Trading suspended due to severe late wake deviation (+${driftMinutes}m). Preserving capital.',
      };
    } else {
      tradingStatus = 'REQUIRES_PREP';
    }
  }

  // 5. Dynamic Reallocation
  const allocResult = calculateDynamicAllocations(nextState);
  nextState.dynamicAllocations = allocResult.allocations;
  nextState.tasks = allocResult.recalculatedTasks;

  const evtRealloc = createSystemEvent(
    'ScheduleReallocated',
    'dynamicAllocations',
    {
      reallocationReason: allocResult.reallocationReason,
      fallbacksCount: fallbacksApplied.length,
      familyProtected: true,
      departureProtected: true,
    },
    nextState,
    'SYSTEM_KERNEL',
    evtDev.event_id,
    currentClock
  );
  events.push(evtRealloc);

  nextState.events = [...events, ...(nextState.events || [])].slice(0, 300);

  const nextAction = getAutonomousNextAction(nextState);

  const result: LateWakeRecoveryResult = {
    deviationDetected: true,
    plannedWakeMinutes: plannedWake,
    actualWakeMinutes: actualWake,
    driftMinutes,
    compressedRoutineState: targetRoutineState,
    fallbacksApplied,
    reallocatedTasksCount: nextState.tasks.length,
    departurePreserved: true,
    familyPreserved: true,
    tradingGovernanceStatus: tradingStatus,
    nextAction: {
      phaseTitle: nextAction.phaseTitle,
      phaseDesc: nextAction.phaseDesc,
      currentTaskTitle: nextAction.currentTask?.title,
      timeRemainingStr: nextAction.timeRemainingStr,
    },
    message: `Autonomous Late Wake Recovery applied (+${driftMinutes}m drift). Routine set to ${targetRoutineState}. ${fallbacksApplied.length} morning anchors compressed; 4:00 PM Family & Departure commitments preserved.`,
  };

  return {
    state: nextState,
    result,
    events,
  };
};
