import {
  AppState,
  RoutineTask,
  ActivityDefinition,
  ActivityDependency,
  FallbackPolicy,
  AdaptationPattern,
  AdaptationProposal,
  Reward,
} from '../types';

/**
 * Production Execution OS starts without personal policy, routine history, rewards,
 * learned behavior, or domain-specific obligations. HumanKernelOS (or a standalone
 * onboarding flow) must provide those explicitly.
 */
export const INITIAL_TASKS: RoutineTask[] = [];
export const INITIAL_ACTIVITY_DEFINITIONS: ActivityDefinition[] = [];
export const INITIAL_DEPENDENCIES: ActivityDependency[] = [];
export const INITIAL_FALLBACK_POLICIES: FallbackPolicy[] = [];
export const INITIAL_ADAPTATION_PATTERNS: AdaptationPattern[] = [];
export const INITIAL_ADAPTATION_PROPOSALS: AdaptationProposal[] = [];
export const INITIAL_REWARDS: Reward[] = [];

export const DEFAULT_APP_STATE: AppState = {
  currentMode: 'GREEN',
  dayType: 'STANDARD',
  routineState: 'STANDARD',
  routineChangeReason: 'Awaiting authoritative operating plan.',
  autonomyLevel: 0,
  isSimulatedTime: false,
  simulatedTime: '00:00',

  tasks: [],
  activities: [],
  activityInstances: [],
  dependencies: [],
  fallbackPolicies: [],
  dynamicAllocations: [],
  deviations: [],
  interventions: [],
  adaptationPatterns: [],
  adaptationProposals: [],
  adaptationVersionHistory: [],
  historicalDays: [],
  longitudinalWindow: '30d',
  userOverrides: [],
  events: [],
  activeHumanDecision: null,
  lastReallocationReason: 'No authoritative schedule has been supplied.',
  lastDecisionReason: 'Awaiting execution context.',
  autonomousResolutionCount: 0,

  // Legacy standalone compatibility state. Core execution logic must not treat
  // these domain-specific objects as policy authority.
  identityStatus: {
    rememberedDream: false,
    rememberedWho: false,
    rememberedWhere: false,
    rememberedWhatBuilding: false,
    completedToday: false,
  },
  tradingProtocol: {
    isTradingDay: false,
    marketAnalyzed: false,
    setupDetected: false,
    setupName: '',
    strategyCriteriaMet: false,
    riskLimitsSatisfied: false,
    stopLossDefined: false,
    executed: false,
    tradeNotes: '',
    closedTerminal: false,
    noSetupJustified: false,
  },
  companyOfTheDay: {
    companyName: '',
    objective: '',
    targetOutcome: '',
    actions: [],
  },
  dailyReview: {
    date: '',
    accomplished: '',
    failed: '',
    why: '',
    learned: '',
    priorityTomorrow: '',
    gratitude: '',
  },
  tomorrowPlan: {
    top3: ['', '', ''],
    scheduleFocus: '',
    plannedMeal: '',
    workoutType: '',
    companyPriority: '',
    familyActivity: '',
    tradingConditions: '',
  },
  dreamEntries: [],

  rewardPoints: 0,
  rewards: [],
  history: [],
  activeView: 'NOW',
  pointsAwardedTasks: [],

  activeTimers: {
    outdoorLight: { isRunning: false, startedAt: null, accumulatedSeconds: 0, targetSeconds: 0 },
    meditation: { isRunning: false, startedAt: null, accumulatedSeconds: 0, targetSeconds: 0 },
    deepWork: { isRunning: false, startedAt: null, accumulatedSeconds: 0, targetSeconds: 0, soundType: 'NONE' },
  },
  focusSession: {
    isActive: false,
    durationMinutes: 0,
    startedAt: null,
    soundType: 'NONE',
    taskLabel: '',
  },

  victoryQuestionAnswer: '',
  morningWorkoutSetsDone: 0,
  afternoonWorkoutSetsDone: 0,
  morningOutdoorMinutes: 0,
  meditationMinutes: 0,
  selectedDayOverride: null,
  disciplinePenaltiesCount: 0,
  strictTimeEnforcement: true,
  earlyExecutionConfirmTask: null,

  timezone: 'UTC',
  performanceSessions: [],
  activePerformanceSessionId: null,
  dailyPerformanceRecords: [],
  weeklyPerformanceRecords: [],
  dayOfWeekPerformanceProfiles: [],
  weeklyInsights: [],
  weeklyAdaptationRecommendations: [],

  version: 1,
  registeredDevices: [],
  conflictLog: [],
  notifications: [],
};
