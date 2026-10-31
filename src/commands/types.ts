import {
  AppState,
  SystemEvent,
  SystemMode,
  DayType,
  AutonomyLevel,
  RoutineTask,
  UserOverrideRecord,
  TomorrowPlan,
  TradingProtocol,
  CompanyOfTheDay,
  DailyReview,
  IdentityStatus,
  DynamicAllocation
} from '../types';
import { IClock } from '../clock';
import { IUnitOfWork, IExecutionRepository } from '../repositories/interfaces';

export interface CommandContext {
  clock: IClock;
  repository: IExecutionRepository;
  unitOfWork?: IUnitOfWork;
}

export interface CommandResult<TData = any> {
  success: boolean;
  state: AppState;
  events: SystemEvent[];
  error?: string;
  message?: string;
  data?: TData;
}

export interface ICommand<TData = any> {
  readonly type: string;
  validate?(state: AppState, context: CommandContext): { valid: boolean; error?: string };
  authorize?(state: AppState, context: CommandContext): { authorized: boolean; reason?: string };
}

// ----------------------------------------------------
// Specific Command Types
// ----------------------------------------------------

export interface PlanTomorrowPayload {
  plan: Partial<TomorrowPlan>;
  date?: string;
}

export interface ActivateDayPayload {
  mode?: SystemMode;
  dayType?: DayType;
  date?: string;
}

export interface StartActivityPayload {
  taskId: string;
}

export interface PauseActivityPayload {
  taskId: string;
  reason?: string;
}

export interface ResumeActivityPayload {
  taskId: string;
}

export interface CompleteActivityPayload {
  taskId: string;
  executionStatus?: 'ON_TIME' | 'MISSED_LATE' | 'COMPRESSED' | 'FALLBACK_EXECUTED';
  missedWindow?: boolean;
  penaltyCutPoints?: number;
  completedAtMinutes?: number;
}

export interface AdjustActivityPayload {
  taskId: string;
  startMinutes?: number;
  endMinutes?: number;
  reason?: string;
}

export interface AdvanceActivityPayload {
  taskId: string;
  minutes: number;
  reason: string;
}

export interface DeferActivityPayload {
  taskId: string;
  minutes: number;
  reason: string;
}

export interface CompressActivityPayload {
  taskId: string;
  targetDurationMinutes: number;
  reason: string;
  fallbackTierLevel?: number;
}

export interface ReplaceActivityPayload {
  taskId: string;
  replacementTaskId: string;
  reason: string;
}

export interface OverrideActivityPayload {
  taskId: string;
  overrideType: UserOverrideRecord['overrideType'];
  reason: string;
  modifications?: Partial<RoutineTask>;
  signature?: string;
}

export interface RecalculateDayPayload {
  force?: boolean;
  reason?: string;
}

export interface ApproveDecisionPayload {
  decisionId: string;
  optionId: string;
}

export interface RejectDecisionPayload {
  decisionId: string;
  reason?: string;
}

export interface PauseAutonomyPayload {
  reason?: string;
}

export interface ResumeAutonomyPayload {
  targetLevel?: AutonomyLevel;
}

export interface SetSystemModePayload {
  mode: SystemMode;
}

export interface SetDayTypePayload {
  dayType: DayType;
}

export interface SetSimulatedTimePayload {
  isSimulatedTime: boolean;
  simulatedTime: string;
}

export interface TriggerFallbackPayload {
  taskId: string;
  targetTierLevel: number;
  reason?: string;
}

export interface ApplyAdaptationProposalPayload {
  proposalId: string;
}

export interface RollbackAdaptationProposalPayload {
  proposalId: string;
  reason?: string;
}

export interface RetainAdaptationProposalPayload {
  proposalId: string;
}

export interface RejectAdaptationProposalPayload {
  proposalId: string;
}

export interface EvaluateAdaptationMeasurementPayload {
  proposalId: string;
}

export interface AcceptDisciplinePenaltyPayload {
  taskId: string;
  penaltyPoints?: number;
}

export interface RecordTradingProtocolPayload {
  protocol: Partial<TradingProtocol>;
}

export interface RecordCompanyOfTheDayPayload {
  company: Partial<CompanyOfTheDay>;
}

export interface RecordDailyReviewPayload {
  review: Partial<DailyReview>;
}

export interface RecordIdentityStatusPayload {
  identity: Partial<IdentityStatus>;
}

export interface LateWakeRecoveryPayload {
  actualWakeMinutes?: number;
  actualWakeTime?: string;
  reason?: string;
}

// HEE-011 Performance Payloads
export interface CreatePerformanceSessionPayload {
  activityInstanceId: string;
  environmentType?: 'IN_APP' | 'GUIDED' | 'ASSISTED' | 'PHYSICAL' | 'EXTERNAL' | 'INTEGRATED';
  protocolId?: string;
}

export interface PreparePerformanceSessionPayload {
  sessionId: string;
}

export interface ReadyPerformanceSessionPayload {
  sessionId: string;
}

export interface StartPerformanceSessionPayload {
  sessionId: string;
}

export interface PausePerformanceSessionPayload {
  sessionId: string;
}

export interface ResumePerformanceSessionPayload {
  sessionId: string;
}

export interface AdvancePerformanceStepPayload {
  sessionId: string;
  stepIndex: number;
  quantity?: number;
  branchSelectedId?: string;
  notes?: string;
}

export interface AttachPerformanceArtifactPayload {
  sessionId: string;
  artifactType: 'NOTE' | 'CODE_COMMIT' | 'DOCUMENT' | 'TRADE_RECORD' | 'PLAN' | 'METRIC';
  title: string;
  uriOrRef?: string;
  contentSnippet?: string;
  provenance?: 'USER_AUTHORED' | 'AI_GENERATED' | 'AI_ASSISTED' | 'INTEGRATED_SYSTEM';
}

export interface RecordPerformanceEvidencePayload {
  sessionId: string;
  type: string;
  source: 'SYSTEM' | 'USER' | 'INTEGRATION' | 'EXTERNAL_SENSOR';
  trustLevel: 'E0' | 'E1' | 'E2' | 'E3' | 'E4';
  payload: Record<string, any>;
}

export interface RequestPerformanceExtensionPayload {
  sessionId: string;
  requestedMinutes: number;
  reason: string;
}

export interface ClosePerformanceSessionPayload {
  sessionId: string;
  outcome: 'COMPLETED' | 'PARTIAL' | 'BLOCKED' | 'ABANDONED';
  reason?: string;
  qualityAssessment?: {
    score?: number;
    focusDepth?: 'HIGH' | 'MEDIUM' | 'LOW';
    interruptionImpact?: 'NONE' | 'MINOR' | 'SEVERE';
    userReflection?: string;
  };
}

export interface CancelPerformanceSessionPayload {
  sessionId: string;
  reason: string;
}


export interface RedeemRewardPayload {
  rewardId: string;
}


export interface SetHOSOperatingPlanPayload {
  plan: import('../types').HOSDailyOperatingPlan;
}

export interface ResolveScheduleProposalPayload {
  proposalId: string;
  decision: 'ACCEPT' | 'REJECT';
}

export interface UpsertExternalExecutionGatePayload {
  gate: import('../types').ExternalExecutionGate;
}
