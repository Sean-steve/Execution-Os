import { AppState, RoutineTask, FallbackTier } from '../types';
import { getCurrentTimeMinutes, formatMinutesToTime } from '../services/storageService';
import { checkTaskDependencies } from '../services/dependencyEngine';
import { getTaskFallbackTiers } from '../services/fallbackEngine';
import { calculateDynamicAllocations, PROTECTED_FAMILY_START } from './legacyStandaloneAllocationEngine';

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

  // Synthesize concise contextual decision explanation
  let decisionReason = '';
  const isFamilyWindowSoon = currentMinutes >= 900 && currentMinutes < PROTECTED_FAMILY_START;
  const timeUntilFamily = Math.max(0, PROTECTED_FAMILY_START - currentMinutes);

  if (selectedTask.id === 'task-awaken') {
    decisionReason = 'Begin the day with sovereign identity reset before digital inputs enter your mind.';
  } else if (selectedTask.id === 'task-outside-light' || selectedTask.id === 'task-workout-morning') {
    decisionReason = 'Physical priming unlocks cognitive peak for Deep Work Build. Execute now.';
  } else if (selectedTask.id === 'task-command-center') {
    decisionReason = 'Lock Daily Definition of Victory to orient all subsequent builder blocks.';
  } else if (selectedTask.id === 'task-deep-work-build') {
    if (isFamilyWindowSoon) {
      decisionReason = `Engage sprint now: ${timeUntilFamily}m remaining before protected 4:00 PM family presence block.`;
    } else {
      decisionReason = 'Command Center parameters locked. This is your primary high-leverage builder block.';
    }
  } else if (selectedTask.id === 'task-trading-protocol') {
    if (state.tradingProtocol.marketAnalyzed && (!state.tradingProtocol.setupDetected || state.tradingProtocol.noSetupJustified)) {
      decisionReason = 'No Setup = No Trade rule satisfied. Terminal closed; focus shifted entirely to core asset building.';
    } else {
      decisionReason = 'Execute objective pre-market analysis with strict risk validation before taking any trade.';
    }
  } else if (
    selectedTask.id === 'task-family-life' || 
    selectedTask.id === 'task-family-connection' || 
    selectedTask.id === 'task-dinner-family' ||
    selectedTask.anchorId === 'ANCHOR_8_HUMAN_LIFE' || 
    selectedTask.anchorId === 'ANCHOR_9_CONNECT'
  ) {
    decisionReason = 'Family presence is a protected high-governance anchor. Phone away, full unhurried attention.';
  } else if (selectedTask.id === 'task-evening-review' || selectedTask.id === 'task-daily-analysis') {
    decisionReason = 'Score the 7 Pillars, evaluate Daily Victory, and lock tomorrow blueprint for a clear mind.';
  } else {
    decisionReason = `Highest-priority available action in the current ${mode} execution window.`;
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
