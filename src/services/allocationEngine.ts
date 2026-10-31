import { AppState, DynamicAllocation, RoutineTask } from '../types';
import { getCurrentTimeMinutes } from './storageService';
import { checkTaskDependencies } from './dependencyEngine';
import { getFallbackPolicyForTask, selectOptimalFallbackTier } from './fallbackEngine';
import { getWeeklyPerformanceFitModifier } from './weeklyPerformanceIntelligence';
import {
  getAuthoritativeProtectedCommitments,
  requestSingleActivityScheduleChange,
} from './scheduleAuthority';

export interface AllocationResult {
  allocations: DynamicAllocation[];
  recalculatedTasks: RoutineTask[];
  reallocationReason: string;
  hasScheduleCompression: boolean;
  isFeasible: boolean;
}

function overlaps(startA: number, endA: number, startB: number, endB: number) {
  return startA < endB && endA > startB;
}

function nextProtectedConflict(state: AppState, start: number, end: number) {
  return getAuthoritativeProtectedCommitments(state)
    .filter(c => overlaps(start, end, c.startMinutes, c.endMinutes))
    .sort((a, b) => a.startMinutes - b.startMinutes)[0];
}

/**
 * HEE-003 calculates an execution allocation proposal.
 * It does not decide whole-person policy and does not own the global schedule.
 */
export const calculateDynamicAllocations = (state: AppState): AllocationResult => {
  const currentMinutes = getCurrentTimeMinutes(state);
  const mode = state.currentMode;
  const tasks = [...state.tasks];

  const allowedTasks = tasks
    .filter(t => (t.modesAllowed || ['GREEN', 'YELLOW', 'RED', 'BLACK']).includes(mode))
    .sort((a, b) => {
      const nominalDiff = a.startMinutes - b.startMinutes;
      if (Math.abs(nominalDiff) > 60 || a.isProtected || b.isProtected || a.isNonNegotiable || b.isNonNegotiable) {
        return nominalDiff;
      }
      const aFit = getWeeklyPerformanceFitModifier(state, a);
      const bFit = getWeeklyPerformanceFitModifier(state, b);
      return (a.startMinutes - aFit * 2) - (b.startMinutes - bFit * 2);
    });

  if (!allowedTasks.length) {
    return {
      allocations: [],
      recalculatedTasks: [],
      reallocationReason: 'No executable activities supplied by the current operating plan.',
      hasScheduleCompression: false,
      isFeasible: true,
    };
  }

  const uncompletedPastScheduled = allowedTasks.filter(t => !t.completed && t.endMinutes < currentMinutes);
  const hasScheduleCompression = uncompletedPastScheduled.length > 0;
  const reallocationReason = hasScheduleCompression
    ? `Execution drift detected. HEE-003 produced a bounded reallocation proposal from current execution truth.`
    : 'Nominal execution allocation calculated from supplied operating plan.';

  const minimumStart = Math.min(...allowedTasks.map(t => t.startMinutes));
  let scheduleCursor = Math.max(currentMinutes, minimumStart);
  const allocations: DynamicAllocation[] = [];
  const recalculatedTasks: RoutineTask[] = [];
  let feasible = true;

  for (const task of allowedTasks) {
    const depCheck = checkTaskDependencies(state, task.id);
    const fallbackPolicy = getFallbackPolicyForTask(state, task.id);
    const originalDuration = Math.max(1, task.endMinutes - task.startMinutes);

    if (task.completed || task.isProtected) {
      const start = task.allocatedStartMinutes ?? task.startMinutes;
      const end = task.allocatedEndMinutes ?? task.endMinutes;
      allocations.push({
        activityId: task.id,
        instanceId: `inst-${task.id}`,
        title: task.title,
        originalStartMinutes: task.startMinutes,
        originalEndMinutes: task.endMinutes,
        allocatedStartMinutes: start,
        allocatedEndMinutes: end,
        durationMinutes: end - start,
        isCompressed: end - start < originalDuration,
        isFallback: (task.fallbackLevel || 0) > 0,
        fallbackLevel: task.fallbackLevel || 0,
        isProtected: Boolean(task.isProtected),
        priority: task.isNonNegotiable ? 5 : 3,
        reasonForAdjustment: task.isProtected
          ? 'Authoritative protected commitment preserved.'
          : 'Historical execution preserved.',
        dependencyStatus: depCheck.isBlocked ? 'BLOCKED' : 'SATISFIED',
      });
      recalculatedTasks.push(task);
      if (!task.completed) scheduleCursor = Math.max(scheduleCursor, end);
      continue;
    }

    let targetStart = Math.max(scheduleCursor, task.startMinutes);
    let duration = originalDuration;
    let fallbackLevel = task.fallbackLevel || 0;
    let isCompressed = false;
    let reason = targetStart === task.startMinutes ? 'Scheduled nominally.' : 'Shifted after preceding execution.';

    let conflict = nextProtectedConflict(state, targetStart, targetStart + duration);
    if (conflict) {
      const availableBefore = Math.max(0, conflict.startMinutes - targetStart);
      if (availableBefore >= 10 && fallbackPolicy) {
        const tier = selectOptimalFallbackTier(fallbackPolicy, availableBefore, mode);
        if (tier.durationMinutes <= availableBefore) {
          duration = tier.durationMinutes;
          fallbackLevel = tier.level;
          isCompressed = tier.level > 0 || duration < originalDuration;
          reason = `Compressed before protected commitment "${conflict.title}".`;
        } else {
          targetStart = conflict.endMinutes;
          reason = `Deferred after protected commitment "${conflict.title}".`;
        }
      } else {
        targetStart = conflict.endMinutes;
        reason = `Deferred after protected commitment "${conflict.title}".`;
      }
    }

    // A second protected block can exist after a defer.
    conflict = nextProtectedConflict(state, targetStart, targetStart + duration);
    if (conflict) {
      targetStart = conflict.endMinutes;
      reason = `Moved after protected commitment "${conflict.title}".`;
    }

    const targetEnd = Math.min(1440, targetStart + duration);
    if (targetEnd <= targetStart) feasible = false;

    const fit = getWeeklyPerformanceFitModifier(state, task);
    if (fit) {
      const sign = fit > 0 ? '+' : '';
      reason += ` Weekly performance fit ${sign}${fit} is advisory only.`;
    }

    allocations.push({
      activityId: task.id,
      instanceId: `inst-${task.id}`,
      title: task.title,
      originalStartMinutes: task.startMinutes,
      originalEndMinutes: task.endMinutes,
      allocatedStartMinutes: targetStart,
      allocatedEndMinutes: targetEnd,
      durationMinutes: targetEnd - targetStart,
      isCompressed,
      isFallback: fallbackLevel > 0,
      fallbackLevel,
      isProtected: false,
      priority: task.isNonNegotiable ? 5 : 3,
      reasonForAdjustment: reason,
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

  return {
    allocations,
    recalculatedTasks,
    reallocationReason,
    hasScheduleCompression,
    isFeasible: feasible,
  };
};

export interface PerformanceExtensionAllocationResult {
  approved: boolean;
  reason: string;
  resultingAllocatedEndMinutes?: number;
  state: AppState;
}

export function evaluatePerformanceExtensionAllocation(
  state: AppState,
  activityId: string,
  requestedMinutes: number
): PerformanceExtensionAllocationResult {
  const task = state.tasks.find(t => t.id === activityId);
  if (!task) return { approved: false, reason: `Activity ${activityId} not found.`, state };

  const start = task.allocatedStartMinutes ?? task.startMinutes;
  const currentEnd = task.allocatedEndMinutes ?? task.endMinutes;
  const proposedEnd = Math.min(1440, currentEnd + requestedMinutes);

  const decision = requestSingleActivityScheduleChange(
    state,
    activityId,
    start,
    proposedEnd,
    `HEE-011 requested +${requestedMinutes} minutes.`,
    'REALLOCATE'
  );

  return {
    approved: decision.applied,
    reason: decision.reason,
    resultingAllocatedEndMinutes: decision.applied ? proposedEnd : undefined,
    state: decision.state,
  };
}
