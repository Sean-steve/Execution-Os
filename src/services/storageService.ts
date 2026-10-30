import { AppState, PillarStatus, RoutineTask, SystemMode, PillarKey } from '../types';
import { DEFAULT_APP_STATE } from '../data/defaultData';
import { getClockForState, formatMinutesTo12Hour } from '../clock';

const STORAGE_KEY = 'autonomous_execution_os_v1';

export const loadAppState = (): AppState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_APP_STATE;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_APP_STATE,
      ...parsed,
      tasks: parsed.tasks?.length ? parsed.tasks : DEFAULT_APP_STATE.tasks,
      activities: parsed.activities?.length ? parsed.activities : DEFAULT_APP_STATE.activities,
      dependencies: parsed.dependencies?.length ? parsed.dependencies : DEFAULT_APP_STATE.dependencies,
      fallbackPolicies: parsed.fallbackPolicies?.length ? parsed.fallbackPolicies : DEFAULT_APP_STATE.fallbackPolicies,
      adaptationPatterns: parsed.adaptationPatterns?.length ? parsed.adaptationPatterns : DEFAULT_APP_STATE.adaptationPatterns,
      adaptationProposals: parsed.adaptationProposals?.length ? parsed.adaptationProposals : DEFAULT_APP_STATE.adaptationProposals,
      rewards: parsed.rewards?.length ? parsed.rewards : DEFAULT_APP_STATE.rewards,
      pointsAwardedTasks: parsed.pointsAwardedTasks || [],
      activeTimers: parsed.activeTimers || DEFAULT_APP_STATE.activeTimers,
      events: parsed.events || [],
      deviations: parsed.deviations || [],
      interventions: parsed.interventions || [],
      dynamicAllocations: parsed.dynamicAllocations || [],
      userOverrides: parsed.userOverrides || [],
      autonomousResolutionCount: parsed.autonomousResolutionCount ?? DEFAULT_APP_STATE.autonomousResolutionCount,
      autonomyLevel: parsed.autonomyLevel ?? DEFAULT_APP_STATE.autonomyLevel,
      routineState: parsed.routineState || 'STANDARD',
      activeDate: parsed.activeDate || DEFAULT_APP_STATE.activeDate || new Date().toISOString().split('T')[0],
      timezone: parsed.timezone || DEFAULT_APP_STATE.timezone || 'UTC',
      scheduler: parsed.scheduler || DEFAULT_APP_STATE.scheduler,
      notifications: parsed.notifications || DEFAULT_APP_STATE.notifications || [],
    };
  } catch (e) {
    console.error('Failed to load state from localStorage:', e);
    return DEFAULT_APP_STATE;
  }
};

export const saveAppState = (state: AppState): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Failed to save state to localStorage:', e);
  }
};

export const PENALTY_POINTS_MISSED_WINDOW = 5;

/**
 * Checks if a task has expired past its scheduled time window (with a 5-min grace buffer)
 */
export const isTaskMissedTime = (task: RoutineTask, currentMinutes: number): boolean => {
  return !task.completed && currentMinutes > (task.endMinutes + 5);
};

export type TaskTimeStatus = 'ACTIVE' | 'UPCOMING' | 'EXPIRED' | 'COMPLETED_ON_TIME' | 'COMPLETED_LATE';

/**
 * Evaluates the real-time status of any anchor task against the clock
 */
export const getTaskTimeStatus = (task: RoutineTask, currentMinutes: number): TaskTimeStatus => {
  if (task.completed) {
    return task.missedWindow || task.executionStatus === 'MISSED_LATE' 
      ? 'COMPLETED_LATE' 
      : 'COMPLETED_ON_TIME';
  }
  if (currentMinutes > (task.endMinutes + 5)) {
    return 'EXPIRED';
  }
  if (currentMinutes >= task.startMinutes && currentMinutes <= (task.endMinutes + 5)) {
    return 'ACTIVE';
  }
  return 'UPCOMING';
};

/**
 * Calculates current time in minutes from midnight (0..1439) using Clock abstraction
 */
export const getCurrentTimeMinutes = (state: AppState): number => {
  return getClockForState(state).getCurrentTimeMinutes();
};

/**
 * Formats minutes from midnight to 12-hour AM/PM string
 */
export const formatMinutesToTime = (minutes: number): string => {
  return formatMinutesTo12Hour(minutes);
};

/**
 * Evaluates the 7 Pillars of Daily Execution
 */
export const calculate7Pillars = (state: AppState): {
  pillars: PillarStatus[];
  score: number;
  total: number;
  ratingText: string;
  ratingBadgeColor: string;
} => {
  const mode = state.currentMode;
  const tasks = state.tasks.filter(t => t.modesAllowed.includes(mode));

  // 1. Morning Pillar: Identity + (Meditation or Workout or Shower)
  const morningTasks = tasks.filter(t => t.associatedPillar === 'morning');
  const morningCompleted = morningTasks.filter(t => t.completed).length;
  const morningSatisfied = state.identityStatus.completedToday || (morningTasks.length > 0 && morningCompleted >= (mode === 'RED' ? 1 : Math.ceil(morningTasks.length * 0.6)));

  // 2. Body Pillar: Morning workout (at least 1 set in yellow/red, 2 sets in green) or walk/meals
  const bodyTasks = tasks.filter(t => t.associatedPillar === 'body');
  const bodyCompleted = bodyTasks.filter(t => t.completed).length;
  const workoutTargetSets = mode === 'RED' ? 1 : mode === 'YELLOW' ? 1 : 2;
  const bodySatisfied = (state.morningWorkoutSetsDone >= workoutTargetSets) || (bodyTasks.length > 0 && bodyCompleted >= 1);

  // 3. Mission Pillar: Command Center + Deep Work Build
  const missionTasks = tasks.filter(t => t.associatedPillar === 'mission');
  const missionCompleted = missionTasks.filter(t => t.completed).length;
  const missionSatisfied = missionTasks.length > 0 && missionCompleted >= 1;

  // 4. Business Pillar: Company of the Day (at least 1-3 actions) or operations
  const businessTasks = tasks.filter(t => t.associatedPillar === 'business');
  const businessCompleted = businessTasks.filter(t => t.completed).length;
  const actionsDone = state.companyOfTheDay.actions.filter(a => a.done).length;
  const businessSatisfied = actionsDone >= (mode === 'RED' ? 1 : 2) || businessCompleted >= 1;

  // 5. Wealth / Trading Pillar: Protocol strictly respected
  // NOTE: If no setup detected and trade wasn't taken, that is considered SATISFIED!
  let wealthTradingSatisfied = false;
  let wealthNote = '';
  if (!state.tradingProtocol.isTradingDay) {
    wealthTradingSatisfied = true;
    wealthNote = 'Non-Trading Day (Satisfied)';
  } else if (state.tradingProtocol.setupDetected && state.tradingProtocol.executed && state.tradingProtocol.riskLimitsSatisfied) {
    wealthTradingSatisfied = true;
    wealthNote = 'Setup Executed within Strategy';
  } else if (state.tradingProtocol.marketAnalyzed && (!state.tradingProtocol.setupDetected || state.tradingProtocol.noSetupJustified)) {
    wealthTradingSatisfied = true;
    wealthNote = 'No Setup = No Trade Rule Respected';
  } else if (state.tasks.find(t => t.id === 'task-trading-protocol')?.completed) {
    wealthTradingSatisfied = true;
    wealthNote = 'Trading Protocol Completed';
  } else {
    wealthTradingSatisfied = false;
    wealthNote = 'Market analysis / gatekeeper pending';
  }

  // 6. Family Pillar: Human connection or outing
  const familyTasks = tasks.filter(t => t.associatedPillar === 'family');
  const familyCompleted = familyTasks.filter(t => t.completed).length;
  const familySatisfied = familyTasks.length > 0 && familyCompleted >= 1;

  // 7. Evening Shutdown Pillar: 6-Question Review or Tomorrow Plan
  const eveningTasks = tasks.filter(t => t.associatedPillar === 'eveningShutdown');
  const eveningCompleted = eveningTasks.filter(t => t.completed).length;
  const eveningSatisfied = (Boolean(state.dailyReview.completedAt) || Boolean(state.dailyReview.accomplished.trim())) || eveningCompleted >= 1;

  const pillars: PillarStatus[] = [
    {
      key: 'morning',
      label: 'Morning Awakening',
      description: 'Identity reset, light, stillness & awakened consciousness',
      satisfied: morningSatisfied,
    },
    {
      key: 'body',
      label: 'Physical Vessel',
      description: 'Movement compound sets, nourishment & physical vitalization',
      satisfied: bodySatisfied,
    },
    {
      key: 'mission',
      label: 'Primary Mission',
      description: 'Victory definition locked & deep work battlefield execution',
      satisfied: missionSatisfied,
    },
    {
      key: 'business',
      label: 'Business of the Day',
      description: 'Venture target progression without scattered multitasking',
      satisfied: businessSatisfied,
    },
    {
      key: 'wealthTrading',
      label: 'Wealth & Trading',
      description: 'Objective market gatekeeper (No setup = No trade discipline)',
      satisfied: wealthTradingSatisfied,
      neutralNote: wealthNote,
    },
    {
      key: 'family',
      label: 'Human Connection',
      description: 'Unhurried presence, baby/family connection, scenic outings',
      satisfied: familySatisfied,
    },
    {
      key: 'eveningShutdown',
      label: 'Evening Shutdown',
      description: '6-question daily analysis, score logging & tomorrow blueprint',
      satisfied: eveningSatisfied,
    },
  ];

  const score = pillars.filter(p => p.satisfied).length;
  const total = 7;

  let ratingText = 'System Intervention';
  let ratingBadgeColor = 'bg-red-50 text-red-700 border-red-200';

  if (score === 7) {
    ratingText = '7/7 Exceptional Execution';
    ratingBadgeColor = 'bg-emerald-50 text-emerald-700 border-emerald-200';
  } else if (score === 6) {
    ratingText = '6/7 Excellent Day';
    ratingBadgeColor = 'bg-teal-50 text-teal-700 border-teal-200';
  } else if (score === 5) {
    ratingText = '5/7 Good Execution';
    ratingBadgeColor = 'bg-indigo-50 text-indigo-700 border-indigo-200';
  } else if (score === 4) {
    ratingText = '4/7 Recovery Required';
    ratingBadgeColor = 'bg-amber-50 text-amber-800 border-amber-200';
  }

  return { pillars, score, total, ratingText, ratingBadgeColor };
};

/**
 * Autonomous Next Action Decision Engine
 * Finds the single most pertinent next action right now based on time and state
 */
export const getAutonomousNextAction = (
  state: AppState
): {
  currentTask: RoutineTask | null;
  phaseTitle: string;
  phaseDesc: string;
  timeRemainingStr: string;
  isUrgent: boolean;
  upcomingTask: RoutineTask | null;
} => {
  const currentMinutes = getCurrentTimeMinutes(state);
  const mode = state.currentMode;
  const allowedTasks = state.tasks.filter(t => t.modesAllowed.includes(mode));

  // Find task currently in time window that is uncompleted
  const activeUncompleted = allowedTasks.find(
    t => !t.completed && currentMinutes >= t.startMinutes && currentMinutes <= t.endMinutes
  );

  // If none active in exact window, find the first upcoming uncompleted task
  const upcomingUncompleted = allowedTasks.find(
    t => !t.completed && t.startMinutes > currentMinutes
  );

  // Or the earliest uncompleted task in the day
  const anyUncompleted = allowedTasks.find(t => !t.completed);

  const selectedTask = activeUncompleted || upcomingUncompleted || anyUncompleted || null;

  let phaseTitle = 'Day Complete & Ready for Rest';
  let phaseDesc = 'All scheduled anchors for today have been executed. Protect sleep.';
  let timeRemainingStr = '';
  let isUrgent = false;

  if (currentMinutes < 330) {
    // Before 5:30 AM
    phaseTitle = 'Pre-Dawn Rest (Sleep Phase)';
    phaseDesc = 'Rest deep. Your 5:30 AM Awaken Anchor is approaching.';
    timeRemainingStr = `${330 - currentMinutes}m until 5:30 AM Awaken`;
  } else if (currentMinutes < 410) {
    // 5:30 AM - 6:50 AM
    phaseTitle = 'Phase 1: Awaken & Morning Prime';
    phaseDesc = 'Self, Light, Movement, Shower, Meditation. Build physiological readiness.';
    timeRemainingStr = `${410 - currentMinutes}m left in Prime`;
  } else if (currentMinutes < 465) {
    // 6:50 AM - 7:45 AM
    phaseTitle = 'Phase 2: Command Center & Breakfast';
    phaseDesc = 'Define victory for 10 PM. Fuel without screens or distraction.';
    timeRemainingStr = `${465 - currentMinutes}m left in Briefing`;
  } else if (currentMinutes < 630) {
    // 7:45 AM - 10:30 AM
    phaseTitle = 'Phase 3: Deep Work Battlefield (BUILD)';
    phaseDesc = 'Primary mission. Phone away. Website blockers active. Zero distraction leaks.';
    timeRemainingStr = `${630 - currentMinutes}m in Deep Work`;
    isUrgent = true;
  } else if (currentMinutes < 720) {
    // 10:30 AM - 12:00 PM
    phaseTitle = 'Phase 4: Operational Buffer & Errands';
    phaseDesc = 'Flexible operations, meetings, calls, errands, or departure transition.';
    timeRemainingStr = `${720 - currentMinutes}m in Buffer`;
  } else if (currentMinutes < 960) {
    // 12:00 PM - 4:00 PM
    phaseTitle = 'Phase 5: Production & Company of the Day (EXECUTE)';
    phaseDesc = 'Target single designated venture. Complete 3 discrete micro-actions.';
    timeRemainingStr = `${960 - currentMinutes}m left in Production`;
  } else if (currentMinutes < 1110) {
    // 4:00 PM - 6:30 PM
    phaseTitle = 'Phase 6: Human Life, Family & Outings (LIVE)';
    phaseDesc = 'Movement, unhurried family time, scenic drive. Outcome: Family connected.';
    timeRemainingStr = `${1110 - currentMinutes}m in Family Window`;
  } else if (currentMinutes < 1200) {
    // 6:30 PM - 8:00 PM
    phaseTitle = 'Phase 7: Connect & Dinner';
    phaseDesc = 'Nourishment and presence. Transition completely out of builder mode.';
    timeRemainingStr = `${1200 - currentMinutes}m until Review`;
  } else if (currentMinutes < 1260) {
    // 8:00 PM - 9:00 PM
    phaseTitle = 'Phase 8: Daily Review & Tomorrow Planning (RESET)';
    phaseDesc = 'Score 7 Pillars, answer 6 reflection questions, plan tomorrow blueprint.';
    timeRemainingStr = `${1260 - currentMinutes}m in Review`;
    isUrgent = true;
  } else if (currentMinutes < 1320) {
    // 9:00 PM - 10:00 PM
    phaseTitle = 'Phase 9: Permitted Entertainment & Wind Down';
    phaseDesc = 'Enjoy reading, conversations, relaxation without guilt.';
    timeRemainingStr = `${1320 - currentMinutes}m until 10:00 PM Shutdown`;
  } else {
    // 10:00 PM+
    phaseTitle = 'Anchor 12: Night Shutdown';
    phaseDesc = 'Dark room, screens off. Sleep deeply to fuel tomorrow.';
  }

  // Find next upcoming
  const upcomingTask = selectedTask
    ? allowedTasks.find(t => t.id !== selectedTask.id && !t.completed && t.startMinutes >= selectedTask.endMinutes) || null
    : null;

  return {
    currentTask: selectedTask,
    phaseTitle,
    phaseDesc,
    timeRemainingStr,
    isUrgent,
    upcomingTask,
  };
};

/**
 * Checks "Never Miss Twice" rules
 */
export const checkNeverMissTwice = (state: AppState): {
  hasAlert: boolean;
  missedPillars: PillarKey[];
  message: string;
} => {
  if (!state.history || state.history.length === 0) {
    return { hasAlert: false, missedPillars: [], message: '' };
  }

  const yesterday = state.history[0];
  const missedPillars: PillarKey[] = [];

  (Object.keys(yesterday.pillars) as PillarKey[]).forEach(pillarKey => {
    if (!yesterday.pillars[pillarKey]) {
      missedPillars.push(pillarKey);
    }
  });

  if (missedPillars.length > 0) {
    return {
      hasAlert: true,
      missedPillars,
      message: `NEVER MISS TWICE POLICY: Yesterday missed ${missedPillars.map(p => p.toUpperCase()).join(', ')}. Today these anchors are top mandatory priority!`,
    };
  }

  return { hasAlert: false, missedPillars: [], message: '' };
};
