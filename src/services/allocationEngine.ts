import { AppState, DynamicAllocation, RoutineTask, SystemMode, DayType } from '../types';
import { getCurrentTimeMinutes } from './storageService';
import { checkTaskDependencies } from './dependencyEngine';
import { getFallbackPolicyForTask, selectOptimalFallbackTier } from './fallbackEngine';
import { getWeeklyPerformanceFitModifier } from './weeklyPerformanceIntelligence';

// Protected boundaries (in minutes from midnight)
export const PROTECTED_FAMILY_START = 960;  // 4:00 PM (16:00)
export const PROTECTED_FAMILY_END = 1170;   // 7:30 PM (19:30)
export const EVENING_REVIEW_START = 1200;   // 8:00 PM (20:00)
export const NIGHT_SHUTDOWN_START = 1320;   // 10:00 PM (22:00)

const isFamilyTask = (task: RoutineTask) => {
  return task.id === 'task-family-life' || 
         task.id === 'task-family-connection' || 
         task.id === 'task-family-outing' || 
         task.id === 'task-dinner-family' ||
         task.anchorId === 'ANCHOR_8_HUMAN_LIFE' || 
         task.anchorId === 'ANCHOR_9_CONNECT' ||
         task.associatedPillar === 'family';
};

export interface AllocationResult {
  allocations: DynamicAllocation[];
  recalculatedTasks: RoutineTask[];
  reallocationReason: string;
  hasScheduleCompression: boolean;
  isFeasible: boolean;
}

/**
 * The Central Allocation Engine
 * Dynamically fits remaining uncompleted activities into available time slots
 * while strictly protecting high-governance anchors (Family block, Evening Review).
 */
export const calculateDynamicAllocations = (state: AppState): AllocationResult => {
  const currentMinutes = getCurrentTimeMinutes(state);
  const mode = state.currentMode;
  const dayType = state.dayType;
  const tasks = [...state.tasks];
  
  // Filter tasks allowed in current mode
  const allowedTasks = tasks
    .filter(t => (t.modesAllowed || ['GREEN', 'YELLOW', 'RED', 'BLACK']).includes(mode))
    .sort((a, b) => {
      const nominalDiff = a.startMinutes - b.startMinutes;
      // Preserve broad schedule order. WPI may only influence flexible tasks already near each other.
      if (Math.abs(nominalDiff) > 60 || a.isProtected || b.isProtected || a.isNonNegotiable || b.isNonNegotiable) {
        return nominalDiff;
      }
      const aFit = getWeeklyPerformanceFitModifier(state, a);
      const bFit = getWeeklyPerformanceFitModifier(state, b);
      const aKey = a.startMinutes - aFit * 2;
      const bKey = b.startMinutes - bFit * 2;
      return aKey - bKey;
    });

  // Determine if we have a deviation from schedule (e.g. waking late or lagging behind)
  const uncompletedPastScheduled = allowedTasks.filter(
    t => !t.completed && t.endMinutes < currentMinutes
  );

  let reallocationReason = 'Nominal schedule active.';
  let hasScheduleCompression = false;

  if (uncompletedPastScheduled.length > 0) {
    const minutesLate = currentMinutes - Math.min(...uncompletedPastScheduled.map(t => t.startMinutes));
    reallocationReason = `Autonomous Reallocation: Time drift of ${minutesLate}m detected. Flexible morning anchors compressed via Fallback tiers; Deep Work shifted to optimal pre-family slot; 4:00 PM Family & Evening Review protected.`;
    hasScheduleCompression = true;
  } else if (dayType === 'EARLY_DEPARTURE') {
    reallocationReason = 'Early Departure Mode: Morning routine compressed into rapid 9:00 AM departure envelope.';
    hasScheduleCompression = true;
  }

  let scheduleCursor = Math.max(currentMinutes, 330); // start at current time or 5:30 AM
  let familyCursor = PROTECTED_FAMILY_START;

  const allocations: DynamicAllocation[] = [];
  const recalculatedTasks: RoutineTask[] = [];

  for (const task of allowedTasks) {
    const depCheck = checkTaskDependencies(state, task.id);
    const fallbackPolicy = getFallbackPolicyForTask(state, task.id);
    
    // Check if task is protected
    const isProtected = 
      task.id === 'task-family-life' || 
      task.anchorId === 'ANCHOR_8_HUMAN_LIFE' || 
      task.anchorId === 'ANCHOR_9_CONNECT' ||
      task.isNonNegotiable && (task.id === 'task-command-center' || task.id === 'task-evening-review');

    if (task.completed) {
      // Completed tasks stay in their original or recorded time
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
        isCompressed: (allocEnd - allocStart) < (task.endMinutes - task.startMinutes),
        isFallback: (task.fallbackLevel || 0) > 0,
        fallbackLevel: task.fallbackLevel || 0,
        isProtected,
        priority: task.isNonNegotiable ? 5 : 3,
        reasonForAdjustment: task.executionStatus === 'MISSED_LATE' ? 'Completed with Late Penalty' : 'Executed on time',
        dependencyStatus: 'SATISFIED',
      });
      recalculatedTasks.push(task);
      continue;
    }

    // Uncompleted task logic
    let targetStart = task.startMinutes;
    let targetEnd = task.endMinutes;
    let standardDuration = task.endMinutes - task.startMinutes;
    let allocatedDuration = standardDuration;
    let isCompressed = false;
    let fallbackLevel = 0;
    let adjustmentReason = 'Scheduled nominally';

    if (isFamilyTask(task)) {
      // Family commitments strictly occupy the 16:00 - 19:30 window
      targetStart = Math.max(familyCursor, task.startMinutes);
      allocatedDuration = Math.max(15, standardDuration);
      targetEnd = targetStart + allocatedDuration;
      familyCursor = targetEnd + 5;
      adjustmentReason = 'Protected family commitment strictly preserved.';
    } else if (task.id === 'task-evening-review' || task.id === 'task-daily-analysis' || task.anchorId === 'ANCHOR_10_REVIEW') {
      targetStart = Math.max(EVENING_REVIEW_START, scheduleCursor > PROTECTED_FAMILY_END ? scheduleCursor : EVENING_REVIEW_START);
      allocatedDuration = standardDuration;
      targetEnd = targetStart + allocatedDuration;
      adjustmentReason = 'Evening review preserved for 8:00 PM reset.';
      scheduleCursor = targetEnd + 5;
    } else {
      // Work / Routine / Body task
      targetStart = Math.max(currentMinutes > task.startMinutes ? scheduleCursor : task.startMinutes, scheduleCursor);

      if (targetStart < PROTECTED_FAMILY_START) {
        const maxAvailable = PROTECTED_FAMILY_START - targetStart;
        if (maxAvailable <= 10) {
          // No remaining time before family window: defer to after family block
          targetStart = Math.max(PROTECTED_FAMILY_END, scheduleCursor);
          allocatedDuration = standardDuration;
          targetEnd = targetStart + allocatedDuration;
          adjustmentReason = 'Work deferred to post-family window to protect 4:00 PM commitment.';
        } else if (standardDuration > maxAvailable) {
          if (fallbackPolicy) {
            const optimalTier = selectOptimalFallbackTier(fallbackPolicy, maxAvailable, mode);
            allocatedDuration = optimalTier.durationMinutes;
            fallbackLevel = optimalTier.level;
            isCompressed = optimalTier.level > 0;
            adjustmentReason = `Compressed to Fallback Level ${optimalTier.level} (${optimalTier.title}) to protect 4:00 PM Family block.`;
          } else {
            allocatedDuration = Math.max(10, maxAvailable);
            isCompressed = true;
            adjustmentReason = 'Work compressed to strictly protect 4:00 PM Family commitment.';
          }
          targetEnd = Math.min(PROTECTED_FAMILY_START, targetStart + allocatedDuration);
        } else {
          allocatedDuration = standardDuration;
          targetEnd = targetStart + allocatedDuration;
        }
      } else if (targetStart >= PROTECTED_FAMILY_START && targetStart < PROTECTED_FAMILY_END) {
        // Encroaching on family block: immediately defer past family block
        targetStart = PROTECTED_FAMILY_END;
        allocatedDuration = standardDuration;
        targetEnd = targetStart + allocatedDuration;
        adjustmentReason = 'Work shifted past protected family hours.';
      } else {
        allocatedDuration = standardDuration;
        targetEnd = targetStart + allocatedDuration;
      }
      scheduleCursor = targetEnd + 5;
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
      isProtected,
      priority: task.isNonNegotiable ? 5 : 3,
      reasonForAdjustment: (() => {
        const fit = getWeeklyPerformanceFitModifier(state, task);
        if (!fit) return adjustmentReason;
        const sign = fit > 0 ? '+' : '';
        return `${adjustmentReason} Weekly performance fit: ${sign}${fit} (soft HEE-003 signal).`;
      })(),
      dependencyStatus: depCheck.isBlocked ? 'BLOCKED' : 'SATISFIED',
    });

    recalculatedTasks.push({
      ...task,
      allocatedStartMinutes: targetStart,
      allocatedEndMinutes: targetEnd,
      fallbackLevel,
    });
  }

  return {
    allocations,
    recalculatedTasks,
    reallocationReason,
    hasScheduleCompression,
    isFeasible: true,
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

  const effectiveStart = task.allocatedStartMinutes ?? task.startMinutes;
  const effectiveEnd = task.allocatedEndMinutes ?? task.endMinutes;
  const proposedEnd = effectiveEnd + requestedMinutes;

  const conflictingProtected = state.tasks
    .filter(t =>
      t.id !== activityId &&
      !t.completed &&
      (t.isProtected || isFamilyTask(t) || t.isNonNegotiable) &&
      (t.allocatedStartMinutes ?? t.startMinutes) >= effectiveEnd &&
      (t.allocatedStartMinutes ?? t.startMinutes) < proposedEnd
    )
    .sort((a, b) => (a.allocatedStartMinutes ?? a.startMinutes) - (b.allocatedStartMinutes ?? b.startMinutes))[0];

  if (conflictingProtected) {
    const start = conflictingProtected.allocatedStartMinutes ?? conflictingProtected.startMinutes;
    return {
      approved: false,
      reason: `Extension denied: +${requestedMinutes}m would invade protected "${conflictingProtected.title}" at ${start} minutes.`,
      state,
    };
  }

  const updatedTasks = state.tasks.map(t => {
    if (t.id === activityId) {
      return {
        ...t,
        allocatedEndMinutes: proposedEnd,
      };
    }

    const start = t.allocatedStartMinutes ?? t.startMinutes;
    const end = t.allocatedEndMinutes ?? t.endMinutes;
    if (
      !t.completed &&
      !t.isProtected &&
      !isFamilyTask(t) &&
      !t.isNonNegotiable &&
      start >= effectiveEnd &&
      start < proposedEnd
    ) {
      return {
        ...t,
        allocatedStartMinutes: start + requestedMinutes,
        allocatedEndMinutes: end + requestedMinutes,
      };
    }
    return t;
  });

  const nextState = { ...state, tasks: updatedTasks };
  const allocations = state.dynamicAllocations.map(allocation => {
    const updatedTask = updatedTasks.find(t => t.id === allocation.activityId);
    if (!updatedTask) return allocation;
    return {
      ...allocation,
      allocatedStartMinutes: updatedTask.allocatedStartMinutes ?? allocation.allocatedStartMinutes,
      allocatedEndMinutes: updatedTask.allocatedEndMinutes ?? allocation.allocatedEndMinutes,
      durationMinutes:
        (updatedTask.allocatedEndMinutes ?? allocation.allocatedEndMinutes) -
        (updatedTask.allocatedStartMinutes ?? allocation.allocatedStartMinutes),
      reasonForAdjustment:
        updatedTask.id === activityId
          ? `HEE-011 extension approved by HEE-003 (+${requestedMinutes}m).`
          : allocation.reasonForAdjustment,
    };
  });

  return {
    approved: true,
    reason: `${requestedMinutes} minutes approved by HEE-003; no protected commitment is invaded.`,
    resultingAllocatedEndMinutes: proposedEnd,
    state: { ...nextState, dynamicAllocations: allocations },
  };
}
