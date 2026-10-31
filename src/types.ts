export type SystemMode = 'GREEN' | 'YELLOW' | 'RED';
export type DayType = 'STANDARD' | 'EARLY_DEPARTURE' | 'STRONG_ENDS';

export type RoutineState = 
  | 'STANDARD'
  | 'COMPRESSED'
  | 'DISRUPTED'
  | 'RECOVERY'
  | 'EARLY_EXIT'
  | 'COMPLETED';

export type AutonomyLevel = 0 | 1 | 2 | 3 | 4 | 5;
// Level 0: Inform only
// Level 1: Suggest
// Level 2: Auto-adjust flexible activities
// Level 3: Auto-reallocate execution
// Level 4: Autonomous recovery
// Level 5: Human approval required

export type AnchorId =
  | 'ANCHOR_1_AWAKEN'
  | 'ANCHOR_2_PRIME'
  | 'ANCHOR_3_COMMAND'
  | 'ANCHOR_4_BREAKFAST'
  | 'ANCHOR_5_DEEPWORK_BUILD'
  | 'ANCHOR_6_OPERATIONS'
  | 'ANCHOR_7_EXECUTE_LUNCH'
  | 'ANCHOR_8_HUMAN_LIFE'
  | 'ANCHOR_9_CONNECT'
  | 'ANCHOR_10_REVIEW'
  | 'ANCHOR_11_LIVE'
  | 'ANCHOR_12_SHUTDOWN';

export type InteractiveActionType =
  | 'IDENTITY_CHECK'
  | 'DREAM_JOURNAL'
  | 'OUTSIDE_TIMER'
  | 'WORKOUT_TRACKER'
  | 'MEDITATION_TIMER'
  | 'COMMAND_CENTER'
  | 'TRADING_GATEKEEPER'
  | 'FOCUS_BLOCK'
  | 'COMPANY_TARGET'
  | 'FAMILY_OUTING'
  | 'EVENING_REVIEW'
  | 'GENERIC';

export type DependencyType =
  | 'BLOCKS'
  | 'REQUIRES'
  | 'ENABLES'
  | 'SEQUENCE'
  | 'CONDITIONAL'
  | 'RESOURCE'
  | 'TIME';

export interface ActivityDependency {
  id: string;
  sourceActivityId: string;
  targetActivityId: string;
  type: DependencyType;
  description: string;
  isMandatory: boolean;
  conditionMet?: boolean;
}

export interface FallbackTier {
  level: number; // 0 = Full/standard, 1 = Compressed, 2 = Minimal Viable, 3 = Mobility/Recovery, 4 = Recovery only
  title: string;
  description: string;
  durationMinutes: number;
  expectedOutcome: string;
  preservesIntentScore: number; // 0 to 100
}

export interface FallbackPolicy {
  id: string;
  activityId: string;
  tiers: FallbackTier[];
  activeTierLevel: number;
  triggerCondition?: string;
}

export type EnergyRequirement = 'LOW' | 'MEDIUM' | 'HIGH';
export type FocusRequirement = 'LOW' | 'MEDIUM' | 'HIGH';
export type LocationRequirement = 'ANY' | 'HOME' | 'DESK' | 'OUTDOORS' | 'OFFICE' | 'TRADING_DESK';

export interface ActivityDefinition {
  id: string;
  anchorId: AnchorId;
  title: string;
  objective: string;
  mission: string;
  priority: 1 | 2 | 3 | 4 | 5; // 5 is highest
  estimatedDuration: number;   // in minutes
  minimumDuration: number;     // in minutes
  preferredDuration: number;   // in minutes
  energyRequirement: EnergyRequirement;
  focusRequirement: FocusRequirement;
  locationRequirement: LocationRequirement;
  prerequisites: string[];     // IDs of prerequisite activities
  completionCriteria: string;
  verificationMethod: 'MANUAL_CHECK' | 'TIMER_PASS' | 'GATE_VALIDATION' | 'INPUT_ENTRY' | 'AUTOMATIC';
  fallbackPolicyId: string;
  autonomyLevel: AutonomyLevel;
  modesAllowed: SystemMode[];
  isProtectedCommitment?: boolean; // e.g. Family block is protected from compression/sacrifice
  interactiveActionType?: InteractiveActionType;
  associatedPillar?: PillarKey;
}

export interface ActivityInstance {
  id: string; // unique instance ID (e.g. inst-task-meditation-20260817)
  activityDefinitionId: string;
  date: string;
  scheduledStartMinutes: number;
  scheduledEndMinutes: number;
  actualStartMinutes?: number;
  actualEndMinutes?: number;
  allocatedStartMinutes: number;
  allocatedEndMinutes: number;
  currentFallbackTier: number;
  completed: boolean;
  executionStatus: 'PENDING' | 'ACTIVE' | 'ON_TIME' | 'MISSED_LATE' | 'COMPRESSED' | 'FALLBACK_EXECUTED' | 'SKIPPED' | 'BLOCKED' | 'COMPLETED' | 'PARTIAL';
  completionPercentage: number;
  interruptedCount: number;
  notes?: string;
  reasonForDeviation?: string;
  evidenceOutcome?: string;
}

export interface DynamicAllocation {
  activityId: string;
  instanceId: string;
  title: string;
  originalStartMinutes: number;
  originalEndMinutes: number;
  allocatedStartMinutes: number;
  allocatedEndMinutes: number;
  durationMinutes: number;
  isCompressed: boolean;
  isFallback: boolean;
  fallbackLevel: number;
  isProtected: boolean;
  priority: number;
  reasonForAdjustment?: string;
  dependencyStatus: 'SATISFIED' | 'BLOCKED' | 'PENDING';
}

export type DeviationType =
  | 'LATE'
  | 'MISSED'
  | 'MISSED_WINDOW'
  | 'INTERRUPTED'
  | 'BLOCKED'
  | 'OVERLOADED'
  | 'DEPENDENCY_FAILURE'
  | 'LOW_ENERGY'
  | 'EXTERNAL_EVENT'
  | 'USER_OVERRIDE'
  | 'SYSTEM_FAILURE';

export interface DeviationRecord {
  id: string;
  timestamp: string;
  activityId: string;
  type: DeviationType;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  minutesDelayed?: number;
  likelyCause: string;
  impactSummary: string;
  isResolved: boolean;
  resolvedAutonomously: boolean;
  interventionId?: string;
}

export interface InterventionRecord {
  id: string;
  timestamp: string;
  deviationId: string;
  actionTaken: 'REALLOCATE' | 'COMPRESS_ROUTINE' | 'TRIGGER_FALLBACK' | 'PROPOSE_ADAPTATION' | 'ENFORCE_PENALTY' | 'USER_ESCALATION';
  description: string;
  resultStatus: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  humanApprovalRequired: boolean;
  humanApproved?: boolean;
}

export type LongitudinalWindow = '7d' | '30d' | '60d' | '90d';

export type AdaptationPatternType =
  | 'LOW_COMPLETION_TIME_SLOT'
  | 'FREQUENT_OVERRUN'
  | 'ENERGY_MISMATCH'
  | 'DEPENDENCY_BOTTLENECK'
  | 'RECURRING_LATE_START'
  | 'REPEATED_LATENESS'
  | 'REPEATED_FALLBACK_USAGE'
  | 'REPEATED_MANUAL_MOVEMENT'
  | 'REPEATED_OVERRIDES'
  | 'DURATION_ESTIMATION_ERROR'
  | 'TIME_WINDOW_FAILURE'
  | 'ROUTINE_STATE_FAILURE'
  | 'PROTECTED_COMMITMENT_CONFLICT'
  | 'ALTERNATIVE_WINDOW_SUCCESS';

export type TaskExecutionStatus = 
  | 'ON_TIME'
  | 'COMPLETED'
  | 'PARTIAL'
  | 'PENDING'
  | 'MISSED_LATE' 
  | 'COMPLETED_WITH_OVERRUN' 
  | 'DEGRADED_FALLBACK' 
  | 'ENCROACHED' 
  | 'SKIPPED' 
  | 'BLOCKED';

export interface HistoricalActivityExecution {
  id: string;
  activityId: string;
  activityTitle: string;
  date: string; // "YYYY-MM-DD"
  scheduledStartMinutes: number;
  scheduledEndMinutes: number;
  actualStartMinutes?: number;
  actualEndMinutes?: number;
  plannedDuration: number;
  actualDuration?: number;
  completed: boolean;
  executionStatus: TaskExecutionStatus;
  fallbackTierLevel?: number; // 0 = nominal, 1 = tier 1, 2 = tier 2
  manualAdjustmentsCount?: number;
  overridesCount?: number;
  overrideTypes?: string[];
  conflictWithProtected?: boolean;
  windowType?: 'MORNING' | 'MIDDAY' | 'AFTERNOON' | 'EVENING' | 'NIGHT';
  routineStateAtExecution?: RoutineState;
}

export interface HistoricalExecutionDay {
  date: string; // "YYYY-MM-DD"
  mode: SystemMode;
  dayType: DayType;
  routineState: RoutineState;
  score: number; // 0 - 7
  completionRate: number; // 0 - 100
  onTimeRate: number; // 0 - 100
  activities: HistoricalActivityExecution[];
  deviationsCount: number;
  overridesCount: number;
  fallbackCount: number;
  protectedCommitmentBreached: boolean;
  notes?: string;
  anomalyDay?: boolean;
  anomalyReason?: string;
  adherenceScore?: number;
  activitiesPlanned?: number;
  activitiesCompleted?: number;
  activitiesLate?: number;
  fallbacksTriggered?: number;
  tasks?: any[];
}

export interface AdaptationPattern {
  id: string;
  activityId: string;
  activityTitle?: string;
  patternType: AdaptationPatternType;
  evidenceCount: number;
  failureRatePercent: number;
  failureRatePercentage?: number; // compatibility alias
  window?: LongitudinalWindow;
  windowDays?: number;
  confidenceScore?: number; // 0 - 100
  isSingleDayAnomaly?: boolean; // true if isolated 1-day event (filtered out)
  hypothesis: string;
  evidenceDetails?: string[];
  detectedAt: string;
  occurrences?: number;
  totalSampleSize?: number;
  description?: string;
  title?: string;
  alternativeWindowRecommendation?: {
    recommendedStartMinutes: number;
    recommendedEndMinutes: number;
    recommendedTimeWindow: string;
    historicalSuccessRate: number; // e.g. 100%
    sampleSize: number;
  };
}

export type AdaptationStatus =
  | 'PROPOSED'
  | 'APPROVED'
  | 'AUTO_APPLIED'
  | 'APPLIED'
  | 'MEASURING'
  | 'ACTIVE_MEASURING'
  | 'RETAINED'
  | 'ROLLED_BACK'
  | 'REJECTED';

export interface AdaptationMeasurement {
  measurementStartedAt: string;
  evaluationWindowDays: number;
  sampleCount: number;
  preAdaptationMetrics: {
    failureRate: number;
    onTimeRate: number;
    averageDurationErrorMinutes: number;
    fallbackRate: number;
  };
  postAdaptationMetrics: {
    failureRate: number;
    onTimeRate: number;
    averageDurationErrorMinutes: number;
    fallbackRate: number;
  };
  isImproved: boolean;
  improvementScorePercent: number; // positive = improved, negative = degraded
  recommendation: 'KEEP' | 'ROLLBACK' | 'CONTINUE_MEASURING';
  lastEvaluatedAt?: string;
  status?: string;
  baselineFailureRate?: number;
  postAdaptationFailureRate?: number;
  improvementDeltaPercentage?: number;
  evaluationDays?: number;
}

export interface AdaptationProposal {
  id: string;
  version?: number;
  targetVersion?: string | number;
  patternId?: string;
  activityId?: string;
  activityTitle?: string;
  title: string;
  description: string;
  hypothesis?: string;
  pillar?: PillarKey;
  suggestedChange: {
    activityId?: string;
    property: string;
    fromValue: any;
    toValue: any;
  };
  previousStateSnapshot?: Record<string, any>;
  baselineSnapshot?: Record<string, any>;
  rollbackPayload?: {
    property: string;
    revertToValue: any;
  };
  impactLevel?: 'LOW_RISK_AUTO' | 'HIGH_IMPACT_APPROVAL_REQUIRED';
  impactScore?: number;
  status: AdaptationStatus;
  evidenceCount?: number;
  failureRatePercent?: number;
  failureRatePercentage?: number;
  window?: LongitudinalWindow;
  windowDays?: number | string;
  governanceRequired?: boolean;
  measurement?: AdaptationMeasurement;
  proposedAt?: string;
  createdAt?: string;
  appliedAt?: string;
  rolledBackAt?: string;
  retainedAt?: string;
  rollbackReason?: string;
  governanceApprovalNotes?: string;
}

export interface AdaptationVersionRecord extends AdaptationProposal {
  isCurrentVersion?: boolean;
  appliedBy?: string;
}

export interface LongitudinalIntelligenceSummary {
  selectedWindow: LongitudinalWindow;
  windowDays: number;
  dataCoverageDays: number;
  totalHistoricalDays: number;
  totalExecutionsAnalyzed: number;
  anomalyDaysFilteredCount: number;
  overallCompletionRate: number;
  overallOnTimeRate: number;
  overallFallbackRate: number;
  patternsDetected: AdaptationPattern[];
  activeProposals: AdaptationProposal[];
  versionedHistory: AdaptationProposal[];
  metricTrends: {
    latenessTrend: 'IMPROVING' | 'STABLE' | 'DEGRADING';
    durationAccuracyPercent: number;
    fallbackUsageTrend: 'IMPROVING' | 'STABLE' | 'DEGRADING';
    protectedCommitmentIntegrityPercent: number;
  };
}

export type EventType =
  | 'RoutineActivated'
  | 'RoutineChanged'
  | 'RoutineStateTransitioned'
  | 'TomorrowPlanned'
  | 'TomorrowActivated'
  | 'DayBoundaryCrossed'
  | 'DayActivated'
  | 'DeviationLogged'
  | 'AllocationExpired'
  | 'BackgroundJobExecuted'
  | 'ReconciliationCompleted'
  | 'ActivityScheduled'
  | 'ActivityStarted'
  | 'ActivityProgressed'
  | 'ActivityPaused'
  | 'ActivityResumed'
  | 'ActivityCompleted'
  | 'ActivityPartiallyCompleted'
  | 'ActivitySkipped'
  | 'ActivityMissed'
  | 'ActivityAdjusted'
  | 'AllocationCreated'
  | 'AllocationChanged'
  | 'AllocationRecalculated'
  | 'AllocationPlanCommitted'
  | 'ScheduleReallocated'
  | 'ScheduleChangeProposed'
  | 'ScheduleAuthorityAccepted'
  | 'DependencySatisfied'
  | 'DependencyBroken'
  | 'DependencyChecked'
  | 'TradingGateEvaluated'
  | 'TradingAuthorized'
  | 'TradingBlocked'
  | 'ExecutionStarted'
  | 'ExecutionInterrupted'
  | 'ExecutionResumed'
  | 'ExecutionCompleted'
  | 'DeviationDetected'
  | 'InterventionTriggered'
  | 'FallbackEvaluated'
  | 'FallbackSelected'
  | 'FallbackTriggered'
  | 'FallbackCompleted'
  | 'DecisionRequested'
  | 'DecisionSelected'
  | 'HumanDecisionRequested'
  | 'HumanDecisionReceived'
  | 'DecisionApproved'
  | 'DecisionRejected'
  | 'AdaptationPatternDetected'
  | 'AdaptationProposalCreated'
  | 'AdaptationApproved'
  | 'AdaptationAutoApplied'
  | 'AdaptationApplied'
  | 'AdaptationRolledBack'
  | 'AdaptationMeasured'
  | 'AdaptationRetained'
  | 'AdaptationRejected'
  | 'OverrideRequested'
  | 'OverrideEvaluated'
  | 'OverrideGranted'
  | 'OverrideDenied'
  | 'OverrideCreated'
  | 'DisciplinePenaltyRecorded'
  | 'PointsAwarded'
  | 'RewardRedeemed'
  | 'PerformanceSessionCreated'
  | 'PerformancePreparationStarted'
  | 'PerformanceReady'
  | 'PerformanceSessionStarted'
  | 'PerformanceSessionPaused'
  | 'PerformanceSessionResumed'
  | 'PerformanceSessionInterrupted'
  | 'PerformanceBlocked'
  | 'PerformanceProgressRecorded'
  | 'PerformanceArtifactAttached'
  | 'PerformanceEvidenceRecorded'
  | 'PerformanceExtensionRequested'
  | 'PerformanceExtensionApproved'
  | 'PerformanceExtensionDenied'
  | 'PerformanceSessionClosed'
  | 'PerformanceOutcomeEvaluated'
  | 'DailyPerformanceReconciled'
  | 'DailyPerformanceFinalized'
  | 'WeeklyPerformanceReconciled'
  | 'WeeklyPerformanceFinalized'
  | 'DayOfWeekProfileUpdated'
  | 'PerformancePatternDetected'
  | 'WeeklyInsightGenerated'
  | 'WeeklyAdaptationRecommendationCreated'
  | 'WeeklyAdaptationRecommendationAccepted'
  | 'WeeklyAdaptationRecommendationRejected';

export interface SystemEventActorObject {
  type: 'SYSTEM' | 'USER' | 'ENGINE' | 'GOVERNANCE_GUARD' | 'HUMAN_OPERATOR';
  id: string;
  name?: string;
}

export type SystemEventActor =
  | 'SYSTEM_KERNEL'
  | 'USER'
  | 'GOVERNANCE_GUARD'
  | SystemEventActorObject;

export interface SystemEventSubjectObject {
  type: string;
  id: string;
  title?: string;
}

export type SystemEventSubject = string | SystemEventSubjectObject;

export interface SystemEventMetadata {
  engine?: string;
  policy?: string;
  rationale?: string;
  currentMinutes: number;
  mode: SystemMode;
  routineState: RoutineState;
  stateDiff?: Record<string, { before: any; after: any }> | Record<string, any>;
  sequence_number?: number;
  stream_id?: string;
  stream_version?: number;
  tags?: string[];
  trace_id?: string;
  retry_count?: number;
  schema_version?: string;
  [key: string]: any;
}

export interface SystemEvent<TPayload = Record<string, any>> {
  event_id: string;
  event_type: EventType;
  event_version: string;
  occurred_at: string;
  actor: SystemEventActor;
  subject: SystemEventSubject;
  scope: string;
  correlation_id?: string;
  causation_id?: string;
  payload: TPayload;
  metadata: SystemEventMetadata;
}

export interface UserOverrideRecord {
  id: string;
  timestamp: string;
  activityId: string;
  overrideType: 'ADVANCE' | 'DEFER' | 'COMPRESS' | 'SKIP' | 'REPLACE' | 'FORCE_COMPLETE';
  reason: string;
  previousState: any;
  newState: any;
}

export interface HumanDecisionRequest {
  id: string;
  title: string;
  description: string;
  reason: string;
  options: {
    id: string;
    label: string;
    description: string;
    consequence: string;
  }[];
  urgency: 'HIGH' | 'CRITICAL';
  createdAt: string;
}

export interface ExecutionAnalytics {
  completionRate: number;
  onTimeRate: number;
  recoveryRate: number;
  fallbackRate: number;
  interventionRate: number;
  overrideRate: number;
  autonomousResolutionRate: number; // resolved / total deviations
  totalDeviations: number;
  resolvedDeviations: number;
}

export interface RoutineTask {
  id: string;
  anchorId: AnchorId;
  title: string;
  subtext?: string;
  notes?: string;
  timeWindow: string;
  startMinutes: number; // minutes from 00:00 (e.g. 5:30 AM = 330)
  endMinutes: number;   // minutes from 00:00 (e.g. 6:30 AM = 390)
  isNonNegotiable: boolean;
  completed: boolean;
  modesAllowed: SystemMode[]; // which modes include this task
  interactiveActionType?: InteractiveActionType;
  associatedPillar?: PillarKey;
  completedAtMinutes?: number;
  completedAtDate?: string;
  executionStatus?: 'ON_TIME' | 'MISSED_LATE' | 'PENDING' | 'COMPRESSED' | 'FALLBACK_EXECUTED' | 'PARTIAL' | 'BLOCKED' | 'COMPLETED' | 'SKIPPED';
  missedWindow?: boolean;
  penaltyCutPoints?: number;
  fallbackLevel?: number;
  allocatedStartMinutes?: number;
  allocatedEndMinutes?: number;
  isProtected?: boolean;
  category?: string;
}

export type PillarKey =
  | 'morning'
  | 'body'
  | 'mission'
  | 'business'
  | 'wealthTrading'
  | 'family'
  | 'eveningShutdown';

export interface PillarStatus {
  key: PillarKey;
  label: string;
  description: string;
  satisfied: boolean;
  neutralNote?: string;
}

export interface TradingProtocol {
  isTradingDay: boolean;
  marketAnalyzed: boolean;
  setupDetected: boolean;
  setupName: string;
  strategyCriteriaMet: boolean;
  riskLimitsSatisfied: boolean;
  stopLossDefined: boolean;
  executed: boolean;
  tradeNotes: string;
  closedTerminal: boolean;
  noSetupJustified: boolean;
  preMarketAnalysisDone?: boolean;
  rulesConfirmed?: boolean;
  riskAgreed?: boolean;
  stopLossMandatory?: boolean;
  maxOpenPositions?: number;
  currentOpenPositions?: number;
}

export interface CompanyAction {
  id: string;
  text: string;
  done: boolean;
}

export interface CompanyOfTheDay {
  companyName: string;
  objective: string;
  targetOutcome: string;
  actions: CompanyAction[];
}

export interface DailyReview {
  date: string;
  accomplished: string;
  failed: string;
  why: string;
  learned: string;
  priorityTomorrow: string;
  gratitude: string;
  completedAt?: string;
  winsAndVictories?: string;
  eveningReflection?: string;
}

export interface TomorrowAppointment {
  id: string;
  title: string;
  startMinutes: number; // e.g. 540 = 9:00 AM
  endMinutes: number;   // e.g. 600 = 10:00 AM
  location?: string;
  isProtected?: boolean;
  notes?: string;
}

export interface TomorrowDepartureConstraint {
  hasDeparture: boolean;
  departureTime: string; // "09:00"
  departureMinutes: number; // 540
  travelBufferMinutes: number; // 30
  destination?: string;
  locationRequirement?: LocationRequirement;
}

export interface TomorrowDesiredActivity {
  id: string;
  title: string;
  durationMinutes: number;
  pillar?: PillarKey;
  category: 'DEEP_WORK' | 'WORKOUT' | 'MEDITATION' | 'MEETING' | 'FAMILY' | 'CUSTOM';
  preferredWindow?: string; // "MORNING" | "MIDDAY" | "AFTERNOON" | "EVENING"
  isNonNegotiable?: boolean;
  notes?: string;
}

export interface TomorrowDeadline {
  id: string;
  title: string;
  deadlineTime: string; // "14:00"
  deadlineMinutes: number; // 840
  description?: string;
}

export interface TomorrowCompanyPriority {
  companyName: string;
  objective: string;
  actions: string[];
}

export interface TomorrowFamilyCommitment {
  activity: string;
  startMinutes: number; // 960 (16:00)
  endMinutes: number;   // 1170 (19:30)
  isProtected: boolean;
  notes?: string;
}

export interface TomorrowProtectedCommitment {
  id: string;
  title: string;
  startMinutes: number;
  endMinutes: number;
  isStrict: boolean;
}

export interface TomorrowTradingIntention {
  isTradingDay: boolean;
  setupFocus?: string;
  marketWindow?: string;
  startMinutes?: number;
  endMinutes?: number;
  requirePrepCheck?: boolean;
}

export type TomorrowDesiredRoutine =
  | 'STANDARD'
  | 'ATHLETIC'
  | 'DEEP_BUILD'
  | 'COMPRESSED'
  | 'RECOVERY'
  | 'MINIMUM_VIABLE';

export type TomorrowSpecialCondition =
  | 'NONE'
  | 'TRAVEL'
  | 'SICK_DAY'
  | 'FASTING'
  | 'INVESTOR_PITCH'
  | 'SPRINT'
  | 'EARLY_DEPARTURE'
  | 'STRONG_ENDS';

export interface TomorrowCapacityBreakdown {
  awakeMinutesAvailable: number; // e.g. 1320 - desiredWakeMinutes
  mandatoryAnchorMinutes: number;
  customActivitiesMinutes: number;
  appointmentsMinutes: number;
  protectedFamilyMinutes: number;
  totalCommittedMinutes: number;
  bufferMinutes: number;
  bufferPercentage: number;
}

export interface TomorrowConflict {
  id: string;
  severity: 'CRITICAL' | 'HIGH' | 'WARNING';
  message: string;
  impactedItemIds?: string[];
  resolutionOptions?: string[];
}

export interface TomorrowFeasibilityResult {
  predictedMode: SystemMode;
  predictedDayType: DayType;
  predictedRoutineState: RoutineState;
  feasibilityScore: number; // 0 - 100
  isFeasible: boolean;
  summary: string;
  capacity: TomorrowCapacityBreakdown;
  conflicts: TomorrowConflict[];
  timelinePreview?: DynamicAllocation[];
}

export interface TomorrowPlan {
  // Wake and Core Anchors
  desiredWakeTime?: string; // "05:30"
  desiredWakeMinutes?: number; // 330
  definitionOfVictory?: string;
  top3: [string, string, string];

  // Specific Constraints & Activities
  appointments?: TomorrowAppointment[];
  departureTravelConstraints?: TomorrowDepartureConstraint;
  desiredActivities?: TomorrowDesiredActivity[];
  deadlines?: TomorrowDeadline[];
  companyPriorities?: TomorrowCompanyPriority;
  familyCommitments?: TomorrowFamilyCommitment;
  protectedCommitments?: TomorrowProtectedCommitment[];
  tradingIntention?: TomorrowTradingIntention;
  desiredRoutine?: TomorrowDesiredRoutine;
  specialDayConditions?: TomorrowSpecialCondition;
  knownConstraints?: string[];

  // Legacy/Compatibility fields
  scheduleFocus: string;
  plannedMeal: string;
  workoutType: string;
  companyPriority: string;
  familyActivity: string;
  tradingConditions: string;

  // Multi-Device & Extended Blueprint fields
  wakeTime?: string;
  targetMode?: SystemMode | string;
  plannedTasks?: string[];
  energyPrediction?: string;
  nonNegotiables?: string[];
  eveningReview?: string;
  winsAndVictories?: string;

  // Metadata
  lastPlannedAt?: string;
  lastFeasibilityResult?: TomorrowFeasibilityResult;
}

export interface DayActivationResult {
  success: boolean;
  activatedMode: SystemMode;
  activatedDayType: DayType;
  activatedRoutineState: RoutineState;
  instantiatedTasksCount: number;
  nextAction: {
    phaseTitle: string;
    phaseDesc: string;
    currentTaskTitle?: string;
    timeRemainingStr?: string;
  };
  allocations: DynamicAllocation[];
  message: string;
}

export interface LateWakeRecoveryResult {
  deviationDetected: boolean;
  plannedWakeMinutes: number;
  actualWakeMinutes: number;
  driftMinutes: number;
  compressedRoutineState: RoutineState;
  fallbacksApplied: {
    taskId: string;
    taskTitle: string;
    tierLevel: number;
    originalDuration: number;
    newDuration: number;
  }[];
  reallocatedTasksCount: number;
  departurePreserved: boolean;
  familyPreserved: boolean;
  tradingGovernanceStatus: 'ELIGIBLE' | 'REQUIRES_PREP' | 'SUSPENDED';
  nextAction: {
    phaseTitle: string;
    phaseDesc: string;
    currentTaskTitle?: string;
    timeRemainingStr?: string;
  };
  message: string;
}

export interface DreamEntry {
  id: string;
  timestamp: string;
  title: string;
  content: string;
  clarityRating: number; // 1 to 5
  tags: string[];
}

export interface Reward {
  id: string;
  title: string;
  description: string;
  category: 'EXPERIENCE' | 'ADVENTURE' | 'DINING' | 'TREAT' | 'TECH';
  pointsRequired: number;
  unlocked: boolean;
  redeemed: boolean;
  redeemedAt?: string;
}

export interface DayHistoryRecord {
  date: string;
  score: number; // 0-7
  mode: SystemMode;
  dayType: DayType;
  pillars: Record<PillarKey, boolean>;
  topVictory?: string;
  reflectionSummary?: string;
}

export interface IdentityStatus {
  rememberedDream: boolean;
  rememberedWho: boolean;
  rememberedWhere: boolean;
  rememberedWhatBuilding: boolean;
  completedToday: boolean;
}

export type BackgroundJobType =
  | 'DAY_BOUNDARY_TRANSITION'
  | 'DAY_ACTIVATION'
  | 'TOMORROW_PLAN_EVALUATION'
  | 'SCHEDULED_EXECUTION_EVALUATION'
  | 'EXPIRED_ALLOCATION_DETECTION'
  | 'TIME_SENSITIVE_DECISION'
  | 'NOTIFICATION_GENERATION'
  | 'ADAPTATION_PROCESSING'
  | 'MAINTENANCE_CLEANUP';

export type BackgroundJobStatus = 'IDLE' | 'SCHEDULED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';

export interface BackgroundJobRecord {
  id: string;
  type: BackgroundJobType;
  name: string;
  description: string;
  status: BackgroundJobStatus;
  lastRunAt: string | null;
  nextRunAt: string | null;
  executionCount: number;
  lastDurationMs: number;
  lastResultSummary: string;
  retryCount: number;
  isIdempotent: boolean;
  userScoped: boolean;
  errorMessage?: string;
}

export interface ExecutionNotification {
  id: string;
  timestamp: string;
  type: 'DAY_ACTIVATION' | 'TIME_CRITICAL' | 'EXPIRATION' | 'GOVERNANCE' | 'RECOVERY' | 'VICTORY' | 'MAINTENANCE';
  title: string;
  message: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
  read: boolean;
  actionLink?: string;
  metadata?: Record<string, any>;
}

export interface LifecycleReconciliationResult {
  reconciledAt: string;
  timeDriftMinutes: number;
  dayBoundaryCrossed: boolean;
  previousDate: string;
  newDate: string;
  dayActivated: boolean;
  expiredAllocationsCount: number;
  expiredTasksMarked: string[];
  missedAnchorsHandled: string[];
  lateWakeDetected: boolean;
  lateWakeDriftMinutes: number;
  decisionsGenerated: number;
  notificationsGenerated: number;
  adaptationsTriggered: number;
  summary: string;
}

export type SyncStatus = 'SYNCHRONIZED' | 'SYNCING' | 'CONFLICT' | 'CONFLICT_RESOLVED' | 'OFFLINE';

export type ConflictType =
  | 'CONCURRENT_ACTIVITY_COMPLETION'
  | 'STALE_ALLOCATION'
  | 'OFFLINE_RECONNECT_DRIFT'
  | 'SIMULTANEOUS_ADJUSTMENT'
  | 'OUTDATED_TOMORROW_PLAN'
  | 'DUPLICATE_COMMAND';

export interface DeviceProfile {
  id: string;
  name: string;
  type: 'DESKTOP' | 'MOBILE' | 'TABLET';
  lastSeenAt: string;
  isCurrentDevice?: boolean;
  appVersion?: string;
  platform?: string;
  ipAddress?: string;
}

export interface ConflictResolutionRecord {
  id: string;
  timestamp: string;
  conflictType: ConflictType;
  entityId: string;
  entityName?: string;
  deviceA: string;
  deviceB: string;
  strategy: 'IDEMPOTENT_NOOP' | 'LAST_WRITE_WINS' | 'THREE_WAY_MERGE' | 'AUTHORITATIVE_SERVER_PRESERVED' | 'TIMELINE_NORMALIZED';
  resolutionSummary: string;
  resolvedStateVersion: number;
}

export interface SyncQueueItem {
  id: string;
  idempotencyKey: string;
  commandType: string;
  payload: any;
  createdAt: string;
  baseVersion: number;
  retryCount: number;
  deviceId: string;
  error?: string;
}

export interface SyncMetadata {
  version: number;
  lastSyncedAt: string;
  clientDeviceId: string;
  serverTimestamp: string;
  syncStatus: SyncStatus;
  pendingQueueCount: number;
  conflictCount: number;
}

export interface BackgroundSchedulerState {
  enabled: boolean;
  isRunning: boolean;
  mode: 'ACTIVE' | 'PAUSED' | 'DEGRADED';
  lastTickAt: string | null;
  nextScheduledTickAt: string | null;
  tickIntervalMs: number;
  timezone: string;
  jobs: BackgroundJobRecord[];
  lastReconciliation: LifecycleReconciliationResult | null;
  totalJobsExecuted: number;
  successfulJobsCount: number;
  failedJobsCount: number;
}

// ==========================================
// HEE-011 HUMAN PERFORMANCE ENGINE TYPES
// ==========================================

export type ExecutionEnvironmentType =
  | 'IN_APP'
  | 'GUIDED'
  | 'ASSISTED'
  | 'PHYSICAL'
  | 'EXTERNAL'
  | 'INTEGRATED';

export type PerformanceSessionStatus =
  | 'CREATED'
  | 'PREPARING'
  | 'READY_TO_START'
  | 'ACTIVE'
  | 'PAUSED'
  | 'INTERRUPTED'
  | 'BLOCKED'
  | 'CLOSING'
  | 'COMPLETED'
  | 'PARTIAL'
  | 'ABANDONED'
  | 'INCONCLUSIVE'
  | 'CANCELLED';

export type CompletionPolicyType =
  | 'BINARY_CONFIRMATION'
  | 'MINIMUM_DURATION'
  | 'TARGET_DURATION'
  | 'QUANTITY'
  | 'PROTOCOL'
  | 'OUTCOME'
  | 'INTEGRATION_EVIDENCE'
  | 'COMPOSITE';

export type EvidenceLevel = 'E0' | 'E1' | 'E2' | 'E3' | 'E4';

export type PerformanceStepType =
  | 'PREPARE'
  | 'INSTRUCTION'
  | 'TIMER'
  | 'CHECKPOINT'
  | 'BRANCH'
  | 'EVIDENCE'
  | 'BREAK'
  | 'CLOSE';

export type PerformanceStepStatus =
  | 'PENDING'
  | 'READY'
  | 'ACTIVE'
  | 'SATISFIED'
  | 'COMPLETED'
  | 'SKIPPED'
  | 'FAILED'
  | 'BLOCKED';

export type AIMode = 'COACH' | 'COPILOT' | 'EXECUTOR' | 'OBSERVER' | 'SILENT';

export interface PerformanceStep {
  id: string;
  type: PerformanceStepType;
  title: string;
  description: string;
  targetDurationSeconds?: number;
  minimumDurationSeconds?: number;
  isOptional?: boolean;
  requiresConfirmation?: boolean;
  requiredQuantity?: number;
  branchOptions?: {
    id: string;
    label: string;
    nextStepId?: string;
    isTerminalBranch?: boolean;
    outcome?: 'COMPLETED' | 'PARTIAL' | 'ABANDONED' | 'NO_TRADE';
  }[];
}

export interface PerformanceProtocol {
  id: string;
  version: string;
  name: string;
  description: string;
  applicableActivityType?: InteractiveActionType | string;
  applicableEnvironment: ExecutionEnvironmentType;
  steps: PerformanceStep[];
  preparationRituals?: string[];
  evidencePolicy: {
    requiredLevel: EvidenceLevel;
    allowedEvidenceTypes: string[];
  };
  completionPolicy: CompletionPolicyType;
  targetDurationMinutes?: number;
  minimumDurationMinutes?: number;
}

export interface PerformanceStepExecution {
  stepId: string;
  stepType: PerformanceStepType;
  title: string;
  status: PerformanceStepStatus;
  startedAtUtc?: string;
  completedAtUtc?: string;
  accumulatedSeconds: number;
  quantityAchieved?: number;
  quantityCompleted?: number;
  branchSelectedId?: string;
  notes?: string;
  evidenceRefs?: string[];
}

export interface PerformanceEvidence {
  id: string;
  sessionId: string;
  stepId?: string;
  type: string; // 'TIMER_PASS' | 'SET_COUNTER' | 'CHECKLIST_CONFIRM' | 'COMMIT_HASH' | 'NOTE_BODY' | 'TRADE_GATE_RECORD' | 'SCREEN_AWAY_RETURN'
  source: 'SYSTEM' | 'USER' | 'INTEGRATION' | 'EXTERNAL_SENSOR';
  trustLevel: EvidenceLevel;
  capturedAtUtc: string;
  payload: Record<string, any>;
  isValid: boolean;
}

export interface PerformanceArtifact {
  id: string;
  sessionId: string;
  artifactType: 'NOTE' | 'CODE_COMMIT' | 'DOCUMENT' | 'TRADE_RECORD' | 'PLAN' | 'METRIC';
  title: string;
  uriOrRef?: string;
  contentSnippet?: string;
  provenance: 'USER_AUTHORED' | 'AI_GENERATED' | 'AI_ASSISTED' | 'INTEGRATED_SYSTEM';
  createdAtUtc: string;
}

export interface PerformanceInterruption {
  id: string;
  sessionId?: string;
  startedAtUtc: string;
  resumedAtUtc?: string;
  endedAtUtc?: string;
  durationSeconds?: number;
  cause?: string;
  reason?: string;
  interruptionType?: 'PAUSE' | 'INTERRUPTION' | 'DISTRACTION' | 'SYSTEM_ALERT';
  severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  recoveryDisposition?: 'RESUMED' | 'REALLOCATED' | 'FALLBACK_TRIGGERED' | 'ABANDONED';
}

export interface PerformanceExtensionRequest {
  id: string;
  sessionId: string;
  requestedMinutes: number;
  reason: string;
  status: 'REQUESTED' | 'APPROVED' | 'DENIED' | 'SUPERSEDED';
  evaluatedAtUtc?: string;
  governanceDecisionReason?: string;
  resultingAllocatedEndMinutes?: number;
}

export interface PerformanceEnvironmentConfig {
  environmentType: ExecutionEnvironmentType;
  allowedTools: string[];
  aiMode: AIMode;
  screenAwayPolicy: 'NONE' | 'ENCOURAGE_OFFLINE' | 'STRICT_PRESENCE';
  distractionShieldEnabled: boolean;
  ambientSoundAllowed: boolean;
}

export interface PerformanceQualityAssessment {
  score?: number; // 0 - 100
  focusDepth?: 'HIGH' | 'MEDIUM' | 'LOW';
  interruptionImpact?: 'NONE' | 'MINOR' | 'SEVERE';
  userReflection?: string;
}

export interface PerformanceOutcomeResult {
  outcome: 'COMPLETED' | 'PARTIAL' | 'BLOCKED' | 'ABANDONED' | 'INCONCLUSIVE';
  reason: string;
  completionPercentage: number;
  activeDurationSeconds: number;
  pausedDurationSeconds: number;
  evidenceMet: boolean;
  releasedMinutes?: number; // time released to allocator if finished early
}

export interface PerformanceSession {
  id: string;
  userId: string;
  activityInstanceId: string;
  activityDefinitionId: string;
  routineVersionId?: string;
  title: string;
  objective: string;
  environmentType: ExecutionEnvironmentType;
  protocolId?: string;
  protocolVersion?: string;
  status: PerformanceSessionStatus;
  effectiveAllocationStartMinutes: number;
  effectiveAllocationEndMinutes: number;
  targetDurationMinutes: number;
  minimumDurationMinutes: number;
  startedAtUtc?: string;
  pausedAtUtc?: string;
  resumedAtUtc?: string;
  endedAtUtc?: string;
  activeDurationSeconds: number;
  pausedDurationSeconds: number;
  lastTickAtUtc?: string;
  currentStepIndex: number;
  stepExecutions: PerformanceStepExecution[];
  interruptions: PerformanceInterruption[];
  evidence: PerformanceEvidence[];
  artifacts: PerformanceArtifact[];
  extensionRequests: PerformanceExtensionRequest[];
  environmentConfig: PerformanceEnvironmentConfig;
  qualityAssessment?: PerformanceQualityAssessment;
  completionResult?: PerformanceOutcomeResult;
  blockerReason?: string;
  createdBy: 'USER' | 'SYSTEM' | 'INTEGRATION';
  correlationId?: string;
  causationId?: string;
  version: number;
  createdAtUtc: string;
  updatedAtUtc: string;
}


// ==========================================
// EOS-WPI-001 WEEKLY PERFORMANCE INTELLIGENCE
// ==========================================

export type PerformanceDimensionKey =
  | 'PRIORITY_WEIGHTED_OUTCOMES'
  | 'EXECUTION_RELIABILITY'
  | 'FOCUS_PERFORMANCE'
  | 'PHYSICAL_EXECUTION'
  | 'RECOVERY_EFFECTIVENESS'
  | 'PROTECTED_COMMITMENT_INTEGRITY'
  | 'TRADING_DISCIPLINE'
  | 'SCHEDULE_INTEGRITY'
  | 'LIFE_QUALITY_PROXY';

export type PerformanceConfidence = 'INSUFFICIENT' | 'EMERGING' | 'MODERATE' | 'STRONG';

export interface PerformanceDimensionScore {
  dimension: PerformanceDimensionKey;
  value: number;
  weight: number;
  evidenceCount: number;
  confidence: PerformanceConfidence;
  explanation: string;
}

export interface PlannedLoadScore {
  value: number;
  priorityLoad: number;
  cognitiveLoad: number;
  physicalLoad: number;
  externalCommitmentLoad: number;
  dependencyComplexity: number;
  compressionFactor: number;
  protectedCommitmentDensity: number;
  contextSwitchLoad: number;
  recoveryDemand: number;
}

export interface DailyPerformanceRecord {
  id: string;
  userId: string;
  localDate: string;
  timezone: string;
  weekId: string;
  routineVersionId?: string;
  mode: SystemMode;
  dayType: DayType;
  plannedLoadScore: PlannedLoadScore;
  dimensionScores: PerformanceDimensionScore[];
  priorityWeightedOutcomeScore: number;
  executionReliabilityScore: number;
  focusPerformanceScore: number;
  physicalExecutionScore: number;
  protectedCommitmentIntegrityScore: number;
  tradingDisciplineScore: number | null;
  recoveryEffectivenessScore: number;
  scheduleIntegrityScore: number;
  lifeQualityProxyScore: number | null;
  sustainablePerformanceIndex: number;
  overallDailyPerformanceScore: number;
  adjustedDayStrength: number;
  confidence: PerformanceConfidence;
  sourceEvidenceCount: number;
  topExplanatoryFactors: string[];
  algorithmVersion: string;
  weightVersion: string;
  createdAtUtc: string;
  finalizedAtUtc?: string;
}

export interface WeeklyInsight {
  id: string;
  weekId: string;
  finding: string;
  whyItMatters: string;
  evidenceWindow: string;
  sampleSize: number;
  effectSize?: number;
  confidence: PerformanceConfidence;
  recommendation?: string;
}

export interface WeeklyAdaptationRecommendation {
  id: string;
  sourceInsightId: string;
  targetEngine: 'HEE-003' | 'HEE-006' | 'HEE-010';
  proposedChange: string;
  expectedBenefit: string;
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
  reversible: boolean;
  evidenceCount: number;
  status: 'PROPOSED' | 'ACCEPTED' | 'REJECTED' | 'TRIAL' | 'KEPT' | 'ROLLED_BACK' | 'INCONCLUSIVE';
  createdAtUtc: string;
}

export interface WeeklyPerformanceRecord {
  id: string;
  userId: string;
  weekId: string;
  startDate: string;
  endDate: string;
  timezone: string;
  dailyRecordIds: string[];
  overallWeeklyPerformanceScore: number;
  weeklyPlannedLoad: number;
  weeklyOutcomeAchievement: number;
  weeklyRecoveryEffectiveness: number;
  protectedCommitmentIntegrity: number;
  focusPerformance: number;
  physicalPerformance: number;
  tradingDiscipline: number | null;
  bestDayDate?: string;
  lowestDayDate?: string;
  bestDayByDimension: Partial<Record<PerformanceDimensionKey, string>>;
  confidence: PerformanceConfidence;
  insights: WeeklyInsight[];
  recommendationIds: string[];
  algorithmVersion: string;
  createdAtUtc: string;
  finalizedAtUtc?: string;
}

export interface DayOfWeekPerformanceProfile {
  id: string;
  userId: string;
  weekday: number; // 0=Sunday ... 6=Saturday
  weekdayLabel: string;
  windowStart: string;
  windowEnd: string;
  sampleCount: number;
  medianAdjustedStrength: number;
  meanAdjustedStrength: number;
  variance: number;
  meanFocusPerformance: number;
  meanOutcomeAchievement: number;
  meanRecoveryEffectiveness: number;
  meanProtectedCommitmentIntegrity: number;
  confidence: PerformanceConfidence;
  strongestObservedWindow?: string;
  explanatoryFactors: string[];
  updatedAtUtc: string;
}


export type ScheduleAuthorityMode = 'STANDALONE' | 'HOS_DELEGATED';

export interface ScheduleBoundaryWindow {
  id: string;
  startMinutes: number;
  endMinutes: number;
  type: 'EXECUTION_ALLOWED' | 'PROTECTED' | 'FIXED';
  label?: string;
  source?: 'HOS' | 'USER' | 'EXECUTION_OS';
}

export interface HOSScheduleAuthority {
  mode: ScheduleAuthorityMode;
  planId?: string;
  planRevision?: number;
  effectiveDate?: string;
  approvedWindows: ScheduleBoundaryWindow[];
  protectedWindows: ScheduleBoundaryWindow[];
  maxAutonomousShiftMinutes: number;
  allowAutonomousCompression: boolean;
  receivedAtUtc?: string;
}

export interface ScheduleChangeProposal {
  id: string;
  source: 'EXECUTION_OS';
  authority: 'HOS';
  planId?: string;
  planRevision?: number;
  createdAtUtc: string;
  reason: string;
  status: 'PROPOSED' | 'ACCEPTED' | 'REJECTED' | 'SUPERSEDED';
  changes: {
    activityId: string;
    fromStartMinutes: number;
    fromEndMinutes: number;
    proposedStartMinutes: number;
    proposedEndMinutes: number;
    compressed: boolean;
    fallbackLevel?: number;
  }[];
}

export interface AppState {
  activeDate?: string; // "YYYY-MM-DD"
  timezone?: string; // "UTC", "America/New_York", etc.
  currentMode: SystemMode;
  dayType: DayType;
  routineState: RoutineState;
  routineChangeReason?: string;
  autonomyLevel: AutonomyLevel;
  isSimulatedTime: boolean;
  simulatedTime: string; // "06:30"
  tasks: RoutineTask[];
  activities: ActivityDefinition[];
  activityInstances: ActivityInstance[];
  dependencies: ActivityDependency[];
  fallbackPolicies: FallbackPolicy[];
  dynamicAllocations: DynamicAllocation[];
  scheduleAuthority?: HOSScheduleAuthority;
  pendingScheduleProposals?: ScheduleChangeProposal[];
  deviations: DeviationRecord[];
  interventions: InterventionRecord[];
  adaptationPatterns: AdaptationPattern[];
  adaptationProposals: AdaptationProposal[];
  adaptationVersionHistory?: AdaptationProposal[];
  historicalDays?: HistoricalExecutionDay[];
  longitudinalWindow?: LongitudinalWindow;
  userOverrides: UserOverrideRecord[];
  events: SystemEvent[];
  activeHumanDecision?: HumanDecisionRequest | null;
  lastReallocationReason?: string;
  lastDecisionReason?: string;
  autonomousResolutionCount: number;
  identityStatus: IdentityStatus;
  tradingProtocol: TradingProtocol;
  companyOfTheDay: CompanyOfTheDay;
  dailyReview: DailyReview;
  tomorrowPlan: TomorrowPlan;
  dreamEntries: DreamEntry[];
  rewardPoints: number;
  rewards: Reward[];
  history: DayHistoryRecord[];
  activeView: 'NOW' | 'PERFORMANCE' | 'DASHBOARD' | 'TODAY' | 'ALL_TASKS' | 'TOMORROW_PLANNER' | 'REVIEW' | 'EVENING' | 'SYSTEM' | 'OPERATIONS' | 'COMMAND_CENTER' | 'MORNING_PRIME' | 'DEEP_WORK' | 'TRADING' | 'FAMILY' | 'BACKGROUND_WORKER' | 'CROSS_DEVICE_SYNC' | 'REWARDS' | 'ADAPTATION_LAB' | 'EXECUTION_RADAR' | 'EVENT_AUDIT';
  pointsAwardedTasks: string[]; // List of task IDs or anchor keys that have already awarded reward points today
  scheduler?: BackgroundSchedulerState;
  notifications?: ExecutionNotification[];
  version?: number;
  syncMetadata?: SyncMetadata;
  registeredDevices?: DeviceProfile[];
  conflictLog?: ConflictResolutionRecord[];
  performanceSessions?: PerformanceSession[];
  activePerformanceSessionId?: string | null;
  dailyPerformanceRecords?: DailyPerformanceRecord[];
  weeklyPerformanceRecords?: WeeklyPerformanceRecord[];
  dayOfWeekPerformanceProfiles?: DayOfWeekPerformanceProfile[];
  weeklyInsights?: WeeklyInsight[];
  weeklyAdaptationRecommendations?: WeeklyAdaptationRecommendation[];
  activeTimers: {
    outdoorLight: { isRunning: boolean; startedAt: number | null; accumulatedSeconds: number; targetSeconds: number };
    meditation: { isRunning: boolean; startedAt: number | null; accumulatedSeconds: number; targetSeconds: number };
    deepWork: { isRunning: boolean; startedAt: number | null; accumulatedSeconds: number; targetSeconds: number; soundType: 'NONE' | 'BROWN_NOISE' | 'MEDITATION_DRONE' | 'RAIN_FOCUS' };
    afternoonWorkoutRest?: { isRunning: boolean; startedAt: number | null; durationSeconds: number };
  };
  focusSession: {
    isActive: boolean;
    durationMinutes: number;
    startedAt: number | null;
    soundType: 'NONE' | 'BROWN_NOISE' | 'MEDITATION_DRONE' | 'RAIN_FOCUS';
    taskLabel: string;
  };
  victoryQuestionAnswer: string;
  morningWorkoutSetsDone: number;
  afternoonWorkoutSetsDone: number;
  morningOutdoorMinutes: number;
  meditationMinutes: number;
  selectedDayOverride?: number | null; // 0=Sunday..6=Saturday or null for system
  disciplinePenaltiesCount: number;
  strictTimeEnforcement: boolean;
  earlyExecutionConfirmTask?: RoutineTask | null;
}
