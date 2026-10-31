import { AppState, DynamicAllocation, RoutineTask, SystemMode, DayType } from '../types';
import { getCurrentTimeMinutes } from './storageService';
import { checkTaskDependencies } from './dependencyEngine';
import { getFallbackPolicyForTask, selectOptimalFallbackTier } from './fallbackEngine';
import { getWeeklyPerformanceFitModifier } from './weeklyPerformanceIntelligence';
import { getProtectedScheduleWindows, reconcileWithScheduleAuthority } from './scheduleAuthorityService';
export { STANDALONE_FAMILY_START as PROTECTED_FAMILY_START, STANDALONE_FAMILY_END as PROTECTED_FAMILY_END } from '../data/standalonePolicyFixture';

export interface AllocationResult {
  allocations: DynamicAllocation[];
  recalculatedTasks: RoutineTask[];
  reallocationReason: string;
  hasScheduleCompression: boolean;
  isFeasible: boolean;
  scheduleProposal?: import('../types').ScheduleChangeProposal;
  autonomousChangesApplied?: number;
  proposedChangesCount?: number;
}

const isProtectedExecutionTask = (state: AppState, task: RoutineTask): boolean => {
  const definition = state.activities.find(a => a.id === task.id);
  return Boolean(task.isProtected || definition?.isProtectedCommitment);
};

const nextProtectedWindow = (
  state: AppState,
  startMinutes: number,
  endMinutes: number,
  activityId: string
) => getProtectedScheduleWindows(state)
  .filter(window => window.id !== activityId && window.id !== `task-window-${activityId}`)
  .sort((a, b) => a.startMinutes - b.startMinutes)
  .find(window => startMinutes < window.endMinutes && endMinutes > window.startMinutes);

/**
 * HEE-003 allocation engine.
 *
 * It optimizes execution locally. In HOS_DELEGATED mode the resulting plan is
 * reconciled against the HOS Daily Operating Plan before any changes become
 * authoritative.
 */
export const calculateDynamicAllocations = (state: AppState): AllocationResult => {
  const currentMinutes = getCurrentTimeMinutes(state);
  const mode = state.currentMode;
  const tasks = [...state.tasks];

  const allowedTasks = tasks
    .filter(t => (t.modesAllowed || ['GREEN', 'YELLOW', 'RED', 'BLACK']).includes(mode))
    .sort((a, b) => {
      const nominalDiff = a.startMinutes - b.startMinutes;
      if (
        Math.abs(nominalDiff) > 60 ||
        isProtectedExecutionTask(state, a) ||
        isProtectedExecutionTask(state, b) ||
        a.isNonNegotiable ||
        b.isNonNegotiable
      ) {
        return nominalDiff;
      }
      const aFit = getWeeklyPerformanceFitModifier(state, a);
      const bFit = getWeeklyPerformanceFitModifier(state, b);
      return (a.startMinutes - aFit * 2) - (b.startMinutes - bFit * 2);
    });

  const uncompletedPastScheduled = allowedTasks.filter(
    t => !t.completed && t.endMinutes < currentMinutes
  );

  let reallocationReason = 'Nominal execution plan active.';
  let hasScheduleCompression = false;
  if (uncompletedPastScheduled.length > 0) {
    const minutesLate = currentMinutes - Math.min(...uncompletedPastScheduled.map(t => t.startMinutes));
    reallocationReason = `Execution drift of ${minutesLate}m detected; flexible activities were recalculated within approved constraints.`;
    hasScheduleCompression = true;
  } else if (state.dayType === 'EARLY_DEPARTURE') {
    reallocationReason = 'Early-departure constraint requires local execution-plan recalculation.';
    hasScheduleCompression = true;
  }

  const earliestPlannedStart = allowedTasks.length
    ? Math.min(...allowedTasks.map(t => t.startMinutes))
    : currentMinutes;
  let scheduleCursor = Math.max(currentMinutes, earliestPlannedStart);

  const allocations: DynamicAllocation[] = [];
  const recalculatedTasks: RoutineTask[] = [];

  for (const task of allowedTasks) {
    const depCheck = checkTaskDependencies(state, task.id);
    const fallbackPolicy = getFallbackPolicyForTask(state, task.id);
    const isProtected = isProtectedExecutionTask(state, task);

    if (task.completed || isProtected) {
      const allocStart = task.allocatedStartMinutes ?? task.startMinutes;
      const allocEnd = task.allocatedEndMinutes ?? task.endMinutes;
      allocations.push({
        activityId: task.id,
        instanceId: `inst-${task.id}`,
        title: task.title,
        originalStartMinutes: task.startMinutes,
        originalEndMinutes: task.endMinutes,
        allocatedStartMinutes: allocStart,
        allocatedEndMinutes: allocEnd,
        durationMinutes: allocEnd - allocStart,
        isCompressed: false,
        isFallback: (task.fallbackLevel || 0) > 0,
        fallbackLevel: task.fallbackLevel || 0,
        isProtected,
        priority: task.isNonNegotiable ? 5 : 3,
        reasonForAdjustment: task.completed
          ? 'Historical execution preserved.'
          : 'Protected/fixed commitment retained from authoritative plan.',
        dependencyStatus: depCheck.isBlocked ? 'BLOCKED' : 'SATISFIED',
      });
      recalculatedTasks.push(task);
      if (!task.completed) scheduleCursor = Math.max(scheduleCursor, allocEnd + 5);
      continue;
    }

    const standardDuration = Math.max(1, task.endMinutes - task.startMinutes);
    let targetStart = Math.max(task.startMinutes, scheduleCursor);
    let allocatedDuration = standardDuration;
    let targetEnd = targetStart + allocatedDuration;
    let fallbackLevel = 0;
    let isCompressed = false;
    let adjustmentReason = targetStart === task.startMinutes
      ? 'Scheduled nominally.'
      : 'Shifted locally to preserve execution continuity.';

    let conflict = nextProtectedWindow(state, targetStart, targetEnd, task.id);
    if (conflict) {
      const availableBefore = conflict.startMinutes - targetStart;
      if (availableBefore >= standardDuration) {
        targetEnd = targetStart + standardDuration;
      } else if (availableBefore >= 10 && fallbackPolicy) {
        const tier = selectOptimalFallbackTier(fallbackPolicy, availableBefore, mode);
        allocatedDuration = Math.min(availableBefore, tier.durationMinutes);
        fallbackLevel = tier.level;
        isCompressed = tier.level > 0 || allocatedDuration < standardDuration;
        targetEnd = targetStart + allocatedDuration;
        adjustmentReason = `Compressed using fallback tier ${tier.level} to preserve protected "${conflict.label || conflict.id}".`;
      } else {
        targetStart = conflict.endMinutes;
        targetEnd = targetStart + standardDuration;
        adjustmentReason = `Deferred until after protected "${conflict.label || conflict.id}".`;
      }
    }

    // A later protected window may still conflict after the first shift.
    conflict = nextProtectedWindow(state, targetStart, targetEnd, task.id);
    if (conflict) {
      targetStart = conflict.endMinutes;
      targetEnd = targetStart + allocatedDuration;
      adjustmentReason = `Deferred until after protected "${conflict.label || conflict.id}".`;
    }

    const fit = getWeeklyPerformanceFitModifier(state, task);
    if (fit) {
      const sign = fit > 0 ? '+' : '';
      adjustmentReason += ` Weekly performance fit ${sign}${fit} (soft evidence only).`;
    }

    allocations.push({
      activityId: task.id,
      instanceId: `inst-${task.id}`,
      title: task.title,
      originalStartMinutes: task.startMinutes,
      originalEndMinutes: task.endMinutes,
      allocatedStartMinutes: targetStart,
      allocatedEndMinutes: targetEnd,
      durationMinutes: allocatedDuration,
      isCompressed,
      isFallback: fallbackLevel > 0,
      fallbackLevel,
      isProtected: false,
      priority: task.isNonNegotiable ? 5 : 3,
      reasonForAdjustment: adjustmentReason,
      dependencyStatus: depCheck.isBlocked ? 'BLOCKED' : 'SATISFIED',
    });

    recalculatedTasks.push({
      ...task,
      allocatedStartMinutes: targetStart,
      allocatedEndMinutes: targetEnd,
      fallbackLevel,
    });
    scheduleCursor = targetEnd + 5;
  }

  const authority = reconcileWithScheduleAuthority(
    state,
    allocations,
    recalculatedTasks,
    reallocationReason
  );

  return {
    allocations: authority.allocations,
    recalculatedTasks: authority.tasks,
    reallocationReason: authority.proposal
      ? `${reallocationReason} HOS approval required for ${authority.proposedChangesCount} change(s).`
      : reallocationReason,
    hasScheduleCompression,
    isFeasible: true,
    scheduleProposal: authority.proposal,
    autonomousChangesApplied: authority.autonomousChangesApplied,
    proposedChangesCount: authority.proposedChangesCount,
  };
};


export interface PerformanceExtensionAllocationResult {
  approved: boolean;
  reason: string;
  resultingAllocatedEndMinutes?: number;
  state: AppState;
}

/**
 * HEE-003 authoritative evaluation for a HEE-011 request to extend an active performance session.
 * HEE-011 requests time; the Allocation Engine owns the schedule consequence.
 */
export function evaluatePerformanceExtensionAllocation(
  state: AppState,
  activityId: string,
  requestedMinutes: number
): PerformanceExtensionAllocationResult {
  const task = state.tasks.find(t => t.id === activityId);
  if (!task) {
    return { approved: false, reason: `Activity ${activityId} not found.`, state };
  }

  const effectiveEnd = task.allocatedEndMinutes ?? task.endMinutes;
  const proposedEnd = effectiveEnd + requestedMinutes;
  const protectedConflict = getProtectedScheduleWindows(state).find(window =>
    window.id !== activityId &&
    window.id !== `task-window-${activityId}` &&
    effectiveEnd < window.endMinutes &&
    proposedEnd > window.startMinutes
  );

  if (protectedConflict) {
    return {
      approved: false,
      reason: `Extension denied: +${requestedMinutes}m would invade protected "${protectedConflict.label || protectedConflict.id}".`,
      state,
    };
  }

  const proposedTasks = state.tasks.map(t => {
    const start = t.allocatedStartMinutes ?? t.startMinutes;
    const end = t.allocatedEndMinutes ?? t.endMinutes;

    if (t.id === activityId) {
      return { ...t, allocatedEndMinutes: proposedEnd };
    }

    const protectedTask = isProtectedExecutionTask(state, t);
    if (!t.completed && !protectedTask && !t.isNonNegotiable && start >= effectiveEnd && start < proposedEnd) {
      return {
        ...t,
        allocatedStartMinutes: start + requestedMinutes,
        allocatedEndMinutes: end + requestedMinutes,
      };
    }
    return t;
  });

  const proposedAllocations: DynamicAllocation[] = state.dynamicAllocations.length
    ? state.dynamicAllocations.map(allocation => {
        const proposedTask = proposedTasks.find(t => t.id === allocation.activityId);
        if (!proposedTask) return allocation;
        const start = proposedTask.allocatedStartMinutes ?? proposedTask.startMinutes;
        const end = proposedTask.allocatedEndMinutes ?? proposedTask.endMinutes;
        return {
          ...allocation,
          allocatedStartMinutes: start,
          allocatedEndMinutes: end,
          durationMinutes: end - start,
          reasonForAdjustment: proposedTask.id === activityId
            ? `HEE-011 requested +${requestedMinutes}m; HEE-003 evaluated schedule impact.`
            : allocation.reasonForAdjustment,
        };
      })
    : proposedTasks.map(t => ({
        activityId: t.id,
        instanceId: `inst-${t.id}`,
        title: t.title,
        originalStartMinutes: t.startMinutes,
        originalEndMinutes: t.endMinutes,
        allocatedStartMinutes: t.allocatedStartMinutes ?? t.startMinutes,
        allocatedEndMinutes: t.allocatedEndMinutes ?? t.endMinutes,
        durationMinutes: (t.allocatedEndMinutes ?? t.endMinutes) - (t.allocatedStartMinutes ?? t.startMinutes),
        isCompressed: false,
        isFallback: false,
        fallbackLevel: t.fallbackLevel || 0,
        isProtected: isProtectedExecutionTask(state, t),
        priority: t.isNonNegotiable ? 5 : 3,
        reasonForAdjustment: t.id === activityId ? `HEE-011 requested +${requestedMinutes}m.` : 'Current authoritative allocation.',
        dependencyStatus: 'SATISFIED',
      }));

  const authority = reconcileWithScheduleAuthority(
    state,
    proposedAllocations,
    proposedTasks,
    `HEE-011 requested +${requestedMinutes}m for ${activityId}.`
  );

  if (authority.proposal) {
    return {
      approved: false,
      reason: 'Extension requires HOS schedule approval; proposal created and Daily Operating Plan retained.',
      state: {
        ...state,
        pendingScheduleProposals: [
          ...(state.pendingScheduleProposals || []).filter(p => p.status === 'PROPOSED'),
          authority.proposal,
        ],
      },
    };
  }

  return {
    approved: true,
    reason: `${requestedMinutes} minutes approved inside current execution authority boundaries.`,
    resultingAllocatedEndMinutes: proposedEnd,
    state: {
      ...state,
      tasks: authority.tasks,
      dynamicAllocations: authority.allocations,
    },
  };
}
