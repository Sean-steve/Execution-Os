import { AppState, RoutineTask, FallbackTier } from '../types';
import { getCurrentTimeMinutes, formatMinutesToTime } from './storageService';
import { checkTaskDependencies } from './dependencyEngine';
import { getTaskFallbackTiers } from './fallbackEngine';
import { calculateDynamicAllocations } from './allocationEngine';

export interface AutonomousDecisionResult {
  currentTask: RoutineTask | null;
  decisionReason: string;
  phaseTitle: string;
  phaseDesc: string;
  timeRemainingStr: string;
  isUrgent: boolean;
  upcomingTask: RoutineTask | null;
  availableFallbackTiers: FallbackTier[];
  isBlockedByDependency: boolean;
  dependencyBlockReason: string;
  isProtected: boolean;
}

/**
 * Intelligent Decision Engine
 * Answers "WHAT SHOULD I DO NEXT?" with deep contextual awareness and human-readable reasoning.
 */
export const getAutonomousNextDecision = (state: AppState): AutonomousDecisionResult => {
  const currentMinutes = getCurrentTimeMinutes(state);
  const mode = state.currentMode;
  const tasks = state.tasks.filter(t => t.modesAllowed.includes(mode));
  const { allocations } = calculateDynamicAllocations(state);
  const uncompletedTasks = tasks.filter(t => !t.completed);

  if (uncompletedTasks.length === 0) {
    return {
      currentTask: null,
      decisionReason: 'All currently authorized execution items are complete.',
      phaseTitle: 'Execution Complete',
      phaseDesc: 'No further authorized activity is currently pending.',
      timeRemainingStr: '',
      isUrgent: false,
      upcomingTask: null,
      availableFallbackTiers: [],
      isBlockedByDependency: false,
      dependencyBlockReason: '',
      isProtected: false,
    };
  }

  const activeAllocation = allocations.find(a =>
    !state.tasks.find(t => t.id === a.activityId)?.completed &&
    currentMinutes >= a.allocatedStartMinutes &&
    currentMinutes < a.allocatedEndMinutes
  );

  const nextAllocation = activeAllocation || allocations
    .filter(a => !state.tasks.find(t => t.id === a.activityId)?.completed)
    .sort((a, b) => a.allocatedStartMinutes - b.allocatedStartMinutes)[0];

  const selectedTask =
    (nextAllocation ? tasks.find(t => t.id === nextAllocation.activityId) : undefined) ||
    uncompletedTasks[0];

  const depCheck = checkTaskDependencies(state, selectedTask.id);
  const dependencyBlockReason = depCheck.isBlocked
    ? depCheck.blockingReasons[0] || 'A prerequisite is not satisfied.'
    : '';

  const availableFallbackTiers = getTaskFallbackTiers(state, selectedTask.id);
  const definition = state.activities.find(a => a.id === selectedTask.id);
  const isProtected = Boolean(selectedTask.isProtected || definition?.isProtectedCommitment);
  const effectiveStart = nextAllocation?.allocatedStartMinutes ?? selectedTask.allocatedStartMinutes ?? selectedTask.startMinutes;
  const effectiveEnd = nextAllocation?.allocatedEndMinutes ?? selectedTask.allocatedEndMinutes ?? selectedTask.endMinutes;
  const minutesUntilStart = Math.max(0, effectiveStart - currentMinutes);
  const minutesRemaining = Math.max(0, effectiveEnd - currentMinutes);

  let decisionReason: string;
  if (depCheck.isBlocked) {
    decisionReason = `Execution is blocked until prerequisite conditions are satisfied: ${dependencyBlockReason}`;
  } else if (isProtected) {
    decisionReason = 'This is a protected commitment from the authoritative execution plan.';
  } else if (selectedTask.isNonNegotiable) {
    decisionReason = 'This is the highest-priority currently feasible committed activity.';
  } else if ((selectedTask.fallbackLevel || 0) > 0) {
    decisionReason = `Execute the authorized fallback path (tier ${selectedTask.fallbackLevel}) for this activity.`;
  } else if (activeAllocation) {
    decisionReason = 'This activity is currently authorized and active in the effective execution window.';
  } else {
    decisionReason = 'This is the next feasible authorized activity in the current execution plan.';
  }

  const upcomingTask = allocations
    .filter(a => a.activityId !== selectedTask.id && a.allocatedStartMinutes >= effectiveEnd)
    .sort((a, b) => a.allocatedStartMinutes - b.allocatedStartMinutes)
    .map(a => tasks.find(t => t.id === a.activityId))
    .find((t): t is RoutineTask => Boolean(t && !t.completed)) || null;

  const phaseTitle = selectedTask.title;
  const phaseDesc = selectedTask.subtext || 'Execute according to the current activity protocol.';
  const timeRemainingStr = currentMinutes < effectiveStart
    ? `${minutesUntilStart}m until authorized window`
    : `${minutesRemaining}m remaining in effective window`;
  const isUrgent = !depCheck.isBlocked && (
    selectedTask.isNonNegotiable ||
    (currentMinutes >= effectiveStart && minutesRemaining <= 15)
  );

  return {
    currentTask: selectedTask,
    decisionReason,
    phaseTitle,
    phaseDesc,
    timeRemainingStr,
    isUrgent,
    upcomingTask,
    availableFallbackTiers,
    isBlockedByDependency: depCheck.isBlocked,
    dependencyBlockReason,
    isProtected,
  };
};
