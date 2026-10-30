import {
  SystemMode,
  DayType,
  RoutineState,
  AutonomyLevel,
  AnchorId,
  DependencyType,
  InteractiveActionType,
  EnergyRequirement,
  FocusRequirement,
  LocationRequirement,
  PillarKey,
  DeviationType,
  EventType,
  SystemEventActor,
  SystemEventSubject,
  SystemEventMetadata,
  ExecutionEnvironmentType,
  PerformanceSessionStatus,
  CompletionPolicyType,
  EvidenceLevel,
  PerformanceStepType,
  PerformanceStepStatus,
  AIMode,
  PerformanceStep,
  PerformanceStepExecution,
  PerformanceEvidence,
  PerformanceArtifact,
  PerformanceInterruption,
  PerformanceExtensionRequest,
  PerformanceEnvironmentConfig,
  PerformanceQualityAssessment,
  PerformanceOutcomeResult
} from '../types';

/**
 * Concurrency & Versioning Base Interface
 * Satisfies Invariant: "Every mutable aggregate must support version/concurrency protection."
 */
export interface VersionedEntity {
  version: number;
  createdAtUtc: string;
  updatedAtUtc: string;
}

/**
 * User-Scoped Base Interface
 * Satisfies Invariant: "Every user-owned record must be scoped to its owner."
 */
export interface UserScopedEntity {
  userId: string;
}

// 1. UserExecutionProfile
export interface UserExecutionProfile extends VersionedEntity, UserScopedEntity {
  id: string;
  timezone: string; // Explicit user timezone, e.g., 'America/Los_Angeles' or 'UTC'
  currentMode: SystemMode;
  dayType: DayType;
  routineState?: RoutineState;
  routineChangeReason?: string;
  autonomyLevel: AutonomyLevel;
  strictTimeEnforcement: boolean;
  activeView: string;
  rewardPoints: number;
  autonomousResolutionCount: number;
  disciplinePenaltiesCount: number;
  victoryQuestionAnswer?: string;
  identityStatus: {
    rememberedDream: boolean;
    rememberedWho: boolean;
    rememberedWhere: boolean;
    rememberedWhatBuilding: boolean;
    completedToday: boolean;
  };
  tomorrowPlan?: {
    top3: [string, string, string];
    scheduleFocus: string;
    plannedMeal: string;
    workoutType: string;
    companyPriority: string;
    familyActivity: string;
    tradingConditions: string;
  };
  dailyReview?: {
    date: string;
    accomplished: string;
    failed: string;
    why: string;
    learned: string;
    priorityTomorrow: string;
    gratitude: string;
    completedAt?: string;
  };
  companyOfTheDay?: {
    companyName: string;
    objective: string;
    targetOutcome: string;
    actions: { id: string; text: string; done: boolean }[];
  };
  tradingProtocol?: {
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
  };
}

// 2. RoutineDefinition (Definitions != instances invariant)
export interface RoutineDefinition extends VersionedEntity, UserScopedEntity {
  id: string;
  name: string;
  description: string;
  dayType: DayType;
  isDefault: boolean;
  currentVersionId: string;
}

// 3. RoutineVersion
export interface RoutineVersion extends VersionedEntity, UserScopedEntity {
  id: string;
  routineDefinitionId: string;
  versionNumber: number;
  effectiveFromUtc: string;
  effectiveToUtc?: string;
  changeReason?: string;
}

// 4. RoutineStep
export interface RoutineStep extends VersionedEntity, UserScopedEntity {
  id: string;
  routineVersionId: string;
  activityDefinitionId: string;
  orderIndex: number;
  anchorId: AnchorId;
  nominalStartMinutes: number;
  nominalEndMinutes: number;
  isNonNegotiable: boolean;
  isProtected: boolean;
  modesAllowed: SystemMode[];
}

// 5. ActivityDefinition (Definitions != instances invariant)
export interface ActivityDefinitionEntity extends VersionedEntity, UserScopedEntity {
  id: string;
  anchorId: AnchorId;
  title: string;
  objective: string;
  mission: string;
  priority: 1 | 2 | 3 | 4 | 5;
  estimatedDuration: number; // in minutes
  minimumDuration: number;   // in minutes
  preferredDuration: number; // in minutes
  energyRequirement: EnergyRequirement;
  focusRequirement: FocusRequirement;
  locationRequirement: LocationRequirement;
  prerequisites: string[];   // Prerequisite activity definition IDs
  completionCriteria: string;
  verificationMethod: 'MANUAL_CHECK' | 'TIMER_PASS' | 'GATE_VALIDATION' | 'INPUT_ENTRY' | 'AUTOMATIC';
  fallbackPolicyId: string;
  autonomyLevel: AutonomyLevel;
  modesAllowed: SystemMode[];
  isProtectedCommitment?: boolean;
  interactiveActionType?: InteractiveActionType;
  associatedPillar?: PillarKey;
}

// 6. ActivityInstance (Instances != definitions invariant)
export interface ActivityInstanceEntity extends VersionedEntity, UserScopedEntity {
  id: string;
  activityDefinitionId: string;
  date: string; // Local date partition key: YYYY-MM-DD
  scheduledStartMinutes: number;
  scheduledEndMinutes: number;
  allocatedStartMinutes: number;
  allocatedEndMinutes: number;
  actualStartMinutes?: number;
  actualEndMinutes?: number;
  currentFallbackTier: number;
  completed: boolean;
  completedAtUtc?: string;
  executionStatus: 'PENDING' | 'ACTIVE' | 'ON_TIME' | 'MISSED_LATE' | 'COMPRESSED' | 'FALLBACK_EXECUTED' | 'SKIPPED' | 'BLOCKED' | 'COMPLETED' | 'PARTIAL';
  completionPercentage: number;
  interruptedCount: number;
  missedWindow?: boolean;
  penaltyCutPoints?: number;
  notes?: string;
  reasonForDeviation?: string;
  evidenceOutcome?: string;
}

// 7. Allocation (Allocations != execution history invariant)
export interface AllocationEntity extends UserScopedEntity {
  id: string;
  date: string; // YYYY-MM-DD
  activityDefinitionId: string;
  activityInstanceId: string;
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
  version: number;
  calculatedAtUtc: string;
}

// 8. AllocationConflict
export interface AllocationConflictEntity extends UserScopedEntity {
  id: string;
  date: string;
  activityAId: string;
  activityBId: string;
  overlapMinutes: number;
  conflictType: 'WINDOW_OVERLAP' | 'RESOURCE_CONTENTION' | 'DEPENDENCY_VIOLATION';
  resolved: boolean;
  resolutionStrategy?: 'COMPRESS' | 'DEFER' | 'CASCADE_SHIFT' | 'DROP';
  createdAtUtc: string;
}

// 9. Dependency
export interface DependencyEntity extends VersionedEntity, UserScopedEntity {
  id: string;
  sourceActivityId: string;
  targetActivityId: string;
  type: DependencyType;
  description: string;
  isMandatory: boolean;
}

// 10. FallbackPolicy
export interface FallbackPolicyEntity extends VersionedEntity, UserScopedEntity {
  id: string;
  activityId: string;
  activeTierLevel: number;
  triggerCondition?: string;
}

// 11. FallbackOption
export interface FallbackOptionEntity extends VersionedEntity, UserScopedEntity {
  id: string;
  policyId: string;
  level: number;
  title: string;
  description: string;
  durationMinutes: number;
  expectedOutcome: string;
  preservesIntentScore: number;
}

// 12. ExecutionSession (Execution history entity, separate from allocations)
export interface ExecutionSessionEntity extends VersionedEntity, UserScopedEntity {
  id: string;
  activityInstanceId: string;
  startedAtUtc: string;
  endedAtUtc?: string;
  interruptedAtUtc?: string;
  resumedAtUtc?: string;
  status: 'IN_PROGRESS' | 'PAUSED' | 'COMPLETED' | 'ABANDONED';
  durationSeconds: number;
  soundType?: string;
  notes?: string;
}

// 13. ExecutionEvidence (Immutable factual execution records)
export interface ExecutionEvidenceEntity extends UserScopedEntity {
  id: string;
  activityInstanceId: string;
  sessionId?: string;
  evidenceType: 'TIMER_LOG' | 'CHECKLIST_CONFIRM' | 'TRADING_LOG' | 'JOURNAL_ENTRY' | 'WORKOUT_METRIC' | 'MANUAL_DECLARATION';
  payload: Record<string, any>;
  verifiedAtUtc: string;
  verifiedBy: 'SYSTEM' | 'USER';
}

// 14. Deviation
export interface DeviationEntity extends VersionedEntity, UserScopedEntity {
  id: string;
  activityId: string;
  instanceId?: string;
  type: DeviationType;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  minutesDelayed?: number;
  likelyCause: string;
  impactSummary: string;
  isResolved: boolean;
  resolvedAutonomously: boolean;
  interventionId?: string;
  detectedAtUtc: string;
  resolvedAtUtc?: string;
}

// 15. Intervention
export interface InterventionEntity extends VersionedEntity, UserScopedEntity {
  id: string;
  deviationId: string;
  actionTaken: 'REALLOCATE' | 'COMPRESS_ROUTINE' | 'TRIGGER_FALLBACK' | 'PROPOSE_ADAPTATION' | 'ENFORCE_PENALTY' | 'USER_ESCALATION';
  description: string;
  resultStatus: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  humanApprovalRequired: boolean;
  humanApproved?: boolean;
  executedAtUtc: string;
}

// 16. DecisionContext
export interface DecisionContextEntity extends UserScopedEntity {
  id: string;
  triggerEventId?: string;
  deviationId?: string;
  systemMode: SystemMode;
  routineState: RoutineState;
  availableMinutes: number;
  createdAtUtc: string;
}

// 17. DecisionCandidate
export interface DecisionCandidateEntity {
  id: string;
  contextId: string;
  optionKey: string;
  label: string;
  description: string;
  consequence: string;
  utilityScore?: number;
}

// 18. Decision
export interface DecisionEntity extends VersionedEntity, UserScopedEntity {
  id: string;
  contextId: string;
  title: string;
  description: string;
  reason: string;
  urgency: 'HIGH' | 'CRITICAL';
  selectedCandidateId?: string;
  resolutionStatus: 'PENDING' | 'RESOLVED_BY_USER' | 'RESOLVED_BY_TIMEOUT' | 'DISMISSED';
  createdAtUtc: string;
  resolvedAtUtc?: string;
}

// 19. AdaptationPattern
export interface AdaptationPatternEntity extends VersionedEntity, UserScopedEntity {
  id: string;
  activityId: string;
  patternType: string;
  evidenceCount: number;
  failureRatePercent: number;
  hypothesis: string;
  detectedAtUtc: string;
}

// 20. AdaptationProposal
export interface AdaptationProposalEntity extends VersionedEntity, UserScopedEntity {
  id: string;
  patternId: string;
  activityId: string;
  title: string;
  description: string;
  suggestedChange: {
    property: string;
    fromValue: any;
    toValue: any;
  };
  impactLevel: 'LOW_RISK_AUTO' | 'HIGH_IMPACT_APPROVAL_REQUIRED';
  status: string;
  proposedAtUtc: string;
  appliedAtUtc?: string;
}

// 21. Experiment
export interface ExperimentEntity extends VersionedEntity, UserScopedEntity {
  id: string;
  proposalId: string;
  name: string;
  hypothesis: string;
  startDateUtc: string;
  endDateUtc?: string;
  status: 'PLANNED' | 'RUNNING' | 'CONCLUDED_SUCCESS' | 'CONCLUDED_FAILURE';
  metricBaseline: number;
  metricCurrent: number;
}

// 22. GovernancePolicy
export interface GovernancePolicyEntity extends VersionedEntity, UserScopedEntity {
  id: string;
  autonomyLevel: AutonomyLevel;
  maxAutonomousDeferMinutes: number;
  allowAutoFallback: boolean;
  allowAutoRoutineCompression: boolean;
  requireApprovalForSacrifices: boolean;
}

// 23. ProtectedCommitment
export interface ProtectedCommitmentEntity extends VersionedEntity, UserScopedEntity {
  id: string;
  activityDefinitionId: string;
  label: string;
  reason: string;
  neverCompress: boolean;
  neverSkip: boolean;
}

// 24. Override
export interface OverrideEntity extends UserScopedEntity {
  id: string;
  activityId: string;
  overrideType: 'ADVANCE' | 'DEFER' | 'COMPRESS' | 'SKIP' | 'REPLACE' | 'FORCE_COMPLETE';
  reason: string;
  previousState: any;
  newState: any;
  occurredAtUtc: string;
}

// 25. EventRecord
export interface EventRecordEntity extends UserScopedEntity {
  id: string;
  event_id: string;
  event_type: EventType;
  event_version: string;
  occurred_at: string; // UTC ISO-8601
  actor: SystemEventActor;
  subject: SystemEventSubject;
  scope: string;
  correlation_id?: string;
  causation_id?: string;
  payload: Record<string, any>;
  metadata: SystemEventMetadata;
}

// 26. RewardLedger (Audit ledger for rewards & points)
export interface RewardLedgerEntity extends UserScopedEntity {
  id: string;
  transactionType: 'POINTS_EARNED' | 'POINTS_REDEEMED' | 'DISCIPLINE_PENALTY' | 'ADJUSTMENT';
  amount: number;
  balanceAfter: number;
  sourceId?: string;
  reason: string;
  occurredAtUtc: string;
}

/**
 * RewardDefinitionEntity (Catalog of rewards)
 */
export interface RewardDefinitionEntity extends VersionedEntity, UserScopedEntity {
  id: string;
  title: string;
  description: string;
  category: 'EXPERIENCE' | 'ADVENTURE' | 'DINING' | 'TREAT' | 'TECH';
  pointsRequired: number;
  unlocked: boolean;
  redeemed: boolean;
  redeemedAtUtc?: string;
}

/**
 * DayHistoryEntity (Historical day logs)
 */
export interface DayHistoryEntity extends UserScopedEntity {
  id: string;
  date: string; // YYYY-MM-DD
  score: number;
  mode: SystemMode;
  dayType: DayType;
  pillars: Record<PillarKey, boolean>;
  topVictory?: string;
  reflectionSummary?: string;
  createdAtUtc: string;
}

/**
 * LegacyRawMetadataEntity (Preserve unknown legacy state where safe)
 */
export interface LegacyRawMetadataEntity extends UserScopedEntity {
  id: string;
  key: string;
  rawPayload: any;
  migratedAtUtc: string;
}

// ==========================================
// HEE-011 CANONICAL PERFORMANCE ENTITIES
// ==========================================

export interface PerformanceSessionEntity extends VersionedEntity, UserScopedEntity {
  id: string;
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
}

export interface PerformanceProtocolEntity extends VersionedEntity, UserScopedEntity {
  id: string;
  protocolVersion: string;
  name: string;
  description: string;
  applicableActivityType?: string;
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

