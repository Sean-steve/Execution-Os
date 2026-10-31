import { AppState, RoutineTask, FallbackTier } from '../types';
import { getCurrentTimeMinutes, formatMinutesToTime } from './storageService';
import { checkTaskDependencies } from './dependencyEngine';
import { getTaskFallbackTiers } from './fallbackEngine';
import { calculateDynamicAllocations } from './allocationEngine';
import { getAuthoritativeProtectedCommitments } from './scheduleAuthority';
import { getAutonomousNextDecision as getLegacyAutonomousNextDecision } from '../adapters/legacyStandaloneDecisionEngine';
import { getHumanStateDecisionExplanation } from '../hos/humanStateDecisionBridge';

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
  if ((state as any).legacyStandaloneCompatibility) {
    return getLegacyAutonomousNextDecision(state);
  }

  const currentMinutes = getCurrentTimeMinutes(state);
  const mode = state.currentMode;
  const tasks = state.tasks.filter(t => t.modesAllowed.includes(mode));
  
  // Calculate dynamic allocations to see adjusted windows
  const { allocations } = calculateDynamicAllocations(state);

  // 1. Check for active uncompleted tasks
  const uncompletedTasks = tasks.filter(t => !t.completed);

  if (uncompletedTasks.length === 0) {
    return {
      currentTask: null,
      decisionReason: 'All scheduled non-negotiable and flexible anchors for today are complete. Rest and protect sleep.',
      phaseTitle: 'Day Complete & Ready for Rest',
      phaseDesc: 'All anchors satisfied with sovereign precision. Protect deep recovery.',
      timeRemainingStr: 'Victory Complete',
      isUrgent: false,
      upcomingTask: null,
      availableFallbackTiers: [],
      isBlockedByDependency: false,
      dependencyBlockReason: '',
      isProtected: false,
    };
  }

  // Find task whose allocated window covers current time
  let activeAllocation = allocations.find(
    a => !state.tasks.find(t => t.id === a.activityId)?.completed &&
         currentMinutes >= a.allocatedStartMinutes && 
         currentMinutes <= a.allocatedEndMinutes
  );

  // If no task is allocated right at this minute, pick the first uncompleted task
  if (!activeAllocation) {
    activeAllocation = allocations.find(
      a => !state.tasks.find(t => t.id === a.activityId)?.completed
    );
  }

  let selectedTask: RoutineTask | null = null;
  if (activeAllocation) {
    selectedTask = tasks.find(t => t.id === activeAllocation!.activityId) || null;
  }

  if (!selectedTask) {
    selectedTask = uncompletedTasks[0];
  }

  // Dependency evaluation
  const depCheck = checkTaskDependencies(state, selectedTask.id);
  let dependencyBlockReason = '';
  if (depCheck.isBlocked) {
    dependencyBlockReason = depCheck.blockingReasons[0] || 'Prerequisite tasks required first.';
  }

  // Fallback tiers
  const availableFallbackTiers = getTaskFallbackTiers(state, selectedTask.id);

  // Synthesize concise contextual decision explanation without owning domain policy.
  let decisionReason = '';
  const nextProtected = getAuthoritativeProtectedCommitments(state)
    .filter(commitment => commitment.startMinutes >= currentMinutes)
    .sort((a, b) => a.startMinutes - b.startMinutes)[0];
  const timeUntilProtected = nextProtected
    ? Math.max(0, nextProtected.startMinutes - currentMinutes)
    : null;

  if (depCheck.isBlocked) {
    decisionReason = `Execution is waiting on a dependency or external-domain gate: ${dependencyBlockReason}`;
  } else if (selectedTask.isProtected) {
    decisionReason = 'This activity is an authoritative protected commitment. Preserve its execution boundary.';
  } else if (selectedTask.category === 'RECOVERY') {
    decisionReason = 'Recovery is the highest-value feasible action under the current execution state.';
  } else if (timeUntilProtected !== null && timeUntilProtected <= 90) {
    decisionReason = `Execute the current feasible action within the remaining ${timeUntilProtected}m before protected commitment "${nextProtected!.title}".`;
  } else {
    decisionReason = `Highest-priority feasible action in the current ${mode} execution window.`;
  }

  const humanStateExplanation = getHumanStateDecisionExplanation(state, selectedTask);
  if (humanStateExplanation) {
    decisionReason += ` ${humanStateExplanation}`;
  }

  // Compute upcoming task
  const upcomingTask = tasks.find(
    t => t.id !== selectedTask?.id && !t.completed && t.startMinutes >= (selectedTask?.endMinutes || 0)
  ) || null;

  // Phase Title & Descriptions
  let phaseTitle = 'Active Execution Phase';
  let phaseDesc = selectedTask.subtext || selectedTask.title;
  let timeRemainingStr = '';
  let isUrgent = false;

  if (currentMinutes < 330) {
    phaseTitle = 'Pre-Dawn Sleep Phase';
    phaseDesc = 'Rest deep. Your 5:30 AM Awaken Anchor is approaching.';
    timeRemainingStr = `${330 - currentMinutes}m until 5:30 AM`;
  } else if (currentMinutes < 410) {
    phaseTitle = 'Morning Prime & Awakening';
    phaseDesc = 'Identity, Light, Movement, Shower, Meditation. Build physiological readiness.';
    timeRemainingStr = `${410 - currentMinutes}m in Morning Prime`;
  } else if (currentMinutes < 465) {
    phaseTitle = 'Command Center & Fuel';
    phaseDesc = 'Define victory for 10 PM. Fuel without screen distraction.';
    timeRemainingStr = `${465 - currentMinutes}m left in Briefing`;
  } else if (currentMinutes < 630) {
    phaseTitle = 'Deep Work Battlefield (BUILD)';
    phaseDesc = 'Primary mission. Phone away. Website blockers active. Zero distraction leaks.';
    timeRemainingStr = `${630 - currentMinutes}m in Deep Work`;
    isUrgent = true;
  } else if (currentMinutes < 720) {
    phaseTitle = 'Operational Buffer & Errands';
    phaseDesc = 'Flexible operations, meetings, follow-ups, or departure transition.';
    timeRemainingStr = `${720 - currentMinutes}m in Buffer`;
  } else if (currentMinutes < 960) {
    phaseTitle = 'Production & Company Focus';
    phaseDesc = 'Target single designated venture. Complete discrete micro-actions.';
    timeRemainingStr = `${960 - currentMinutes}m in Production`;
  } else if (currentMinutes < 1170) {
    phaseTitle = 'Human Life & Family Connection (LIVE)';
    phaseDesc = 'Movement, unhurried presence, scenic outing. Outcome: Family connected.';
    timeRemainingStr = `${1170 - currentMinutes}m in Family Block`;
  } else if (currentMinutes < 1260) {
    phaseTitle = 'Daily Review & Tomorrow Blueprint';
    phaseDesc = 'Score 7 Pillars, answer 6 reflection questions, plan tomorrow blueprint.';
    timeRemainingStr = `${1260 - currentMinutes}m in Review`;
    isUrgent = true;
  } else {
    phaseTitle = 'Wind Down & Final Rest';
    phaseDesc = 'Allowed entertainment, reading, dark room, sleep deeply.';
  }

  const isProtected = 
    selectedTask.id === 'task-family-life' || 
    selectedTask.id === 'task-family-connection' || 
    selectedTask.id === 'task-dinner-family' ||
    selectedTask.anchorId === 'ANCHOR_8_HUMAN_LIFE' || 
    selectedTask.anchorId === 'ANCHOR_9_CONNECT';

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
