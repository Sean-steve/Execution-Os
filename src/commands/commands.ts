import {
  ICommand,
  CommandContext,
  PlanTomorrowPayload,
  ActivateDayPayload,
  StartActivityPayload,
  PauseActivityPayload,
  ResumeActivityPayload,
  CompleteActivityPayload,
  AdjustActivityPayload,
  AdvanceActivityPayload,
  DeferActivityPayload,
  CompressActivityPayload,
  ReplaceActivityPayload,
  OverrideActivityPayload,
  RecalculateDayPayload,
  ApproveDecisionPayload,
  RejectDecisionPayload,
  PauseAutonomyPayload,
  ResumeAutonomyPayload,
  SetSystemModePayload,
  SetDayTypePayload,
  SetSimulatedTimePayload,
  TriggerFallbackPayload,
  ApplyAdaptationProposalPayload,
  RollbackAdaptationProposalPayload,
  RetainAdaptationProposalPayload,
  RejectAdaptationProposalPayload,
  EvaluateAdaptationMeasurementPayload,
  AcceptDisciplinePenaltyPayload,
  RecordTradingProtocolPayload,
  RecordCompanyOfTheDayPayload,
  RecordDailyReviewPayload,
  RecordIdentityStatusPayload,
  LateWakeRecoveryPayload,
  CreatePerformanceSessionPayload,
  PreparePerformanceSessionPayload,
  ReadyPerformanceSessionPayload,
  StartPerformanceSessionPayload,
  PausePerformanceSessionPayload,
  ResumePerformanceSessionPayload,
  AdvancePerformanceStepPayload,
  AttachPerformanceArtifactPayload,
  RecordPerformanceEvidencePayload,
  RequestPerformanceExtensionPayload,
  ClosePerformanceSessionPayload,
  CancelPerformanceSessionPayload
} from './types';
import { AppState } from '../types';

export class PlanTomorrowCommand implements ICommand {
  readonly type = 'PlanTomorrow';
  constructor(public payload: PlanTomorrowPayload) {}

  validate(state: AppState) {
    if (!this.payload.plan) {
      return { valid: false, error: 'Tomorrow plan payload is required.' };
    }
    return { valid: true };
  }
}

export class ActivateDayCommand implements ICommand {
  readonly type = 'ActivateDay';
  constructor(public payload: ActivateDayPayload = {}) {}

  validate(state: AppState) {
    if (this.payload.mode && !['GREEN', 'YELLOW', 'RED'].includes(this.payload.mode)) {
      return { valid: false, error: `Invalid mode: ${this.payload.mode}` };
    }
    if (this.payload.dayType && !['STANDARD', 'EARLY_DEPARTURE', 'STRONG_ENDS'].includes(this.payload.dayType)) {
      return { valid: false, error: `Invalid dayType: ${this.payload.dayType}` };
    }
    return { valid: true };
  }
}

export class StartActivityCommand implements ICommand {
  readonly type = 'StartActivity';
  constructor(public payload: StartActivityPayload) {}

  validate(state: AppState) {
    if (!this.payload.taskId) {
      return { valid: false, error: 'taskId is required.' };
    }
    const task = state.tasks.find(t => t.id === this.payload.taskId) || state.activities?.find(a => a.id === this.payload.taskId) || (this.payload.taskId && this.payload.taskId.startsWith('task-trading') ? true : undefined);
    if (!task) {
      return { valid: false, error: `Task ${this.payload.taskId} not found.` };
    }
    return { valid: true };
  }
}

export class PauseActivityCommand implements ICommand {
  readonly type = 'PauseActivity';
  constructor(public payload: PauseActivityPayload) {}

  validate(state: AppState) {
    if (!this.payload.taskId) {
      return { valid: false, error: 'taskId is required.' };
    }
    const task = state.tasks.find(t => t.id === this.payload.taskId) || state.activities?.find(a => a.id === this.payload.taskId) || (this.payload.taskId && this.payload.taskId.startsWith('task-trading') ? true : undefined);
    if (!task) {
      return { valid: false, error: `Task ${this.payload.taskId} not found.` };
    }
    return { valid: true };
  }
}

export class ResumeActivityCommand implements ICommand {
  readonly type = 'ResumeActivity';
  constructor(public payload: ResumeActivityPayload) {}

  validate(state: AppState) {
    if (!this.payload.taskId) {
      return { valid: false, error: 'taskId is required.' };
    }
    const task = state.tasks.find(t => t.id === this.payload.taskId) || state.activities?.find(a => a.id === this.payload.taskId) || (this.payload.taskId && this.payload.taskId.startsWith('task-trading') ? true : undefined);
    if (!task) {
      return { valid: false, error: `Task ${this.payload.taskId} not found.` };
    }
    return { valid: true };
  }
}

export class CompleteActivityCommand implements ICommand {
  readonly type = 'CompleteActivity';
  constructor(public payload: CompleteActivityPayload) {}

  validate(state: AppState) {
    if (!this.payload.taskId) {
      return { valid: false, error: 'taskId is required.' };
    }
    const task = state.tasks.find(t => t.id === this.payload.taskId) || state.activities?.find(a => a.id === this.payload.taskId) || (this.payload.taskId && this.payload.taskId.startsWith('task-trading') ? true : undefined);
    if (!task) {
      return { valid: false, error: `Task ${this.payload.taskId} not found.` };
    }
    return { valid: true };
  }
}

export class AdjustActivityCommand implements ICommand {
  readonly type = 'AdjustActivity';
  constructor(public payload: AdjustActivityPayload) {}

  validate(state: AppState) {
    if (!this.payload.taskId) {
      return { valid: false, error: 'taskId is required.' };
    }
    const task = state.tasks.find(t => t.id === this.payload.taskId) || state.activities?.find(a => a.id === this.payload.taskId) || (this.payload.taskId && this.payload.taskId.startsWith('task-trading') ? true : undefined);
    if (!task) {
      return { valid: false, error: `Task ${this.payload.taskId} not found.` };
    }
    if (this.payload.startMinutes !== undefined && (this.payload.startMinutes < 0 || this.payload.startMinutes > 1440)) {
      return { valid: false, error: 'Invalid startMinutes.' };
    }
    if (this.payload.endMinutes !== undefined && (this.payload.endMinutes < 0 || this.payload.endMinutes > 1440)) {
      return { valid: false, error: 'Invalid endMinutes.' };
    }
    return { valid: true };
  }
}

export class AdvanceActivityCommand implements ICommand {
  readonly type = 'AdvanceActivity';
  constructor(public payload: AdvanceActivityPayload) {}

  validate(state: AppState) {
    if (!this.payload.taskId) {
      return { valid: false, error: 'taskId is required.' };
    }
    if (!this.payload.minutes || this.payload.minutes <= 0) {
      return { valid: false, error: 'minutes must be greater than 0.' };
    }
    const task = state.tasks.find(t => t.id === this.payload.taskId);
    if (!task) {
      return { valid: false, error: `Task ${this.payload.taskId} not found.` };
    }
    return { valid: true };
  }
}

export class DeferActivityCommand implements ICommand {
  readonly type = 'DeferActivity';
  constructor(public payload: DeferActivityPayload) {}

  validate(state: AppState) {
    if (!this.payload.taskId) {
      return { valid: false, error: 'taskId is required.' };
    }
    if (!this.payload.minutes || this.payload.minutes <= 0) {
      return { valid: false, error: 'minutes must be greater than 0.' };
    }
    const task = state.tasks.find(t => t.id === this.payload.taskId);
    if (!task) {
      return { valid: false, error: `Task ${this.payload.taskId} not found.` };
    }
    return { valid: true };
  }
}

export class CompressActivityCommand implements ICommand {
  readonly type = 'CompressActivity';
  constructor(public payload: CompressActivityPayload) {}

  validate(state: AppState) {
    if (!this.payload.taskId) {
      return { valid: false, error: 'taskId is required.' };
    }
    if (!this.payload.targetDurationMinutes || this.payload.targetDurationMinutes <= 0) {
      return { valid: false, error: 'targetDurationMinutes must be greater than 0.' };
    }
    const task = state.tasks.find(t => t.id === this.payload.taskId);
    if (!task) {
      return { valid: false, error: `Task ${this.payload.taskId} not found.` };
    }
    return { valid: true };
  }
}

export class ReplaceActivityCommand implements ICommand {
  readonly type = 'ReplaceActivity';
  constructor(public payload: ReplaceActivityPayload) {}

  validate(state: AppState) {
    if (!this.payload.taskId || !this.payload.replacementTaskId) {
      return { valid: false, error: 'Both taskId and replacementTaskId are required.' };
    }
    const task = state.tasks.find(t => t.id === this.payload.taskId);
    if (!task) {
      return { valid: false, error: `Task ${this.payload.taskId} not found.` };
    }
    return { valid: true };
  }
}

export class OverrideActivityCommand implements ICommand {
  readonly type = 'OverrideActivity';
  constructor(public payload: OverrideActivityPayload) {}

  validate(state: AppState) {
    if (!this.payload.taskId) {
      return { valid: false, error: 'taskId is required.' };
    }
    if (!this.payload.overrideType) {
      return { valid: false, error: 'overrideType is required.' };
    }
    if (!this.payload.reason || this.payload.reason.trim().length < 4) {
      return { valid: false, error: 'Override rejected: Valid justification reason is mandatory (minimum 4 characters).' };
    }
    const task = state.tasks.find(t => t.id === this.payload.taskId);
    if (!task) {
      return { valid: false, error: `Task ${this.payload.taskId} not found.` };
    }
    return { valid: true };
  }
}

export class RecalculateDayCommand implements ICommand {
  readonly type = 'RecalculateDay';
  constructor(public payload: RecalculateDayPayload = {}) {}

  validate() {
    return { valid: true };
  }
}

export class ApproveDecisionCommand implements ICommand {
  readonly type = 'ApproveDecision';
  constructor(public payload: ApproveDecisionPayload) {}

  validate(state: AppState) {
    if (!this.payload.decisionId) {
      return { valid: false, error: 'decisionId is required.' };
    }
    return { valid: true };
  }
}

export class RejectDecisionCommand implements ICommand {
  readonly type = 'RejectDecision';
  constructor(public payload: RejectDecisionPayload) {}

  validate(state: AppState) {
    if (!this.payload.decisionId) {
      return { valid: false, error: 'decisionId is required.' };
    }
    return { valid: true };
  }
}

export class PauseAutonomyCommand implements ICommand {
  readonly type = 'PauseAutonomy';
  constructor(public payload: PauseAutonomyPayload = {}) {}

  validate() {
    return { valid: true };
  }
}

export class ResumeAutonomyCommand implements ICommand {
  readonly type = 'ResumeAutonomy';
  constructor(public payload: ResumeAutonomyPayload = {}) {}

  validate() {
    return { valid: true };
  }
}

export class SetSystemModeCommand implements ICommand {
  readonly type = 'SetSystemMode';
  constructor(public payload: SetSystemModePayload) {}

  validate() {
    if (!['GREEN', 'YELLOW', 'RED'].includes(this.payload.mode)) {
      return { valid: false, error: `Invalid mode: ${this.payload.mode}` };
    }
    return { valid: true };
  }
}

export class SetDayTypeCommand implements ICommand {
  readonly type = 'SetDayType';
  constructor(public payload: SetDayTypePayload) {}

  validate() {
    if (!['STANDARD', 'EARLY_DEPARTURE', 'STRONG_ENDS'].includes(this.payload.dayType)) {
      return { valid: false, error: `Invalid dayType: ${this.payload.dayType}` };
    }
    return { valid: true };
  }
}

export class SetSimulatedTimeCommand implements ICommand {
  readonly type = 'SetSimulatedTime';
  constructor(public payload: SetSimulatedTimePayload) {}

  validate() {
    return { valid: true };
  }
}

export class TriggerFallbackCommand implements ICommand {
  readonly type = 'TriggerFallback';
  constructor(public payload: TriggerFallbackPayload) {}

  validate(state: AppState) {
    if (!this.payload.taskId) {
      return { valid: false, error: 'taskId is required.' };
    }
    return { valid: true };
  }
}

export class ApplyAdaptationProposalCommand implements ICommand {
  readonly type = 'ApplyAdaptationProposal';
  constructor(public payload: ApplyAdaptationProposalPayload) {}

  validate(state: AppState) {
    if (!this.payload.proposalId) {
      return { valid: false, error: 'proposalId is required.' };
    }
    return { valid: true };
  }
}

export class RollbackAdaptationProposalCommand implements ICommand {
  readonly type = 'RollbackAdaptationProposal';
  constructor(public payload: RollbackAdaptationProposalPayload) {}

  validate(state: AppState) {
    if (!this.payload.proposalId) {
      return { valid: false, error: 'proposalId is required.' };
    }
    return { valid: true };
  }
}

export class RetainAdaptationProposalCommand implements ICommand {
  readonly type = 'RetainAdaptationProposal';
  constructor(public payload: RetainAdaptationProposalPayload) {}

  validate(state: AppState) {
    if (!this.payload.proposalId) {
      return { valid: false, error: 'proposalId is required.' };
    }
    return { valid: true };
  }
}

export class RejectAdaptationProposalCommand implements ICommand {
  readonly type = 'RejectAdaptationProposal';
  constructor(public payload: RejectAdaptationProposalPayload) {}

  validate(state: AppState) {
    if (!this.payload.proposalId) {
      return { valid: false, error: 'proposalId is required.' };
    }
    return { valid: true };
  }
}

export class EvaluateAdaptationMeasurementCommand implements ICommand {
  readonly type = 'EvaluateAdaptationMeasurement';
  constructor(public payload: EvaluateAdaptationMeasurementPayload) {}

  validate(state: AppState) {
    if (!this.payload.proposalId) {
      return { valid: false, error: 'proposalId is required.' };
    }
    return { valid: true };
  }
}

export class AcceptDisciplinePenaltyCommand implements ICommand {
  readonly type = 'AcceptDisciplinePenalty';
  constructor(public payload: AcceptDisciplinePenaltyPayload) {}

  validate(state: AppState) {
    if (!this.payload.taskId) {
      return { valid: false, error: 'taskId is required.' };
    }
    return { valid: true };
  }
}

export class RecordTradingProtocolCommand implements ICommand {
  readonly type = 'RecordTradingProtocol';
  constructor(public payload: RecordTradingProtocolPayload) {}

  validate() {
    return { valid: true };
  }
}

export class RecordCompanyOfTheDayCommand implements ICommand {
  readonly type = 'RecordCompanyOfTheDay';
  constructor(public payload: RecordCompanyOfTheDayPayload) {}

  validate() {
    return { valid: true };
  }
}

export class RecordDailyReviewCommand implements ICommand {
  readonly type = 'RecordDailyReview';
  constructor(public payload: RecordDailyReviewPayload) {}

  validate() {
    return { valid: true };
  }
}

export class RecordIdentityStatusCommand implements ICommand {
  readonly type = 'RecordIdentityStatus';
  constructor(public payload: RecordIdentityStatusPayload) {}

  validate() {
    return { valid: true };
  }
}

export class LateWakeRecoveryCommand implements ICommand {
  readonly type = 'LateWakeRecovery';
  constructor(public payload: LateWakeRecoveryPayload = {}) {}

  validate() {
    return { valid: true };
  }
}

// ==========================================
// HEE-011 PERFORMANCE COMMANDS
// ==========================================

export class CreatePerformanceSessionCommand implements ICommand {
  readonly type = 'CreatePerformanceSession';
  constructor(public payload: CreatePerformanceSessionPayload) {}

  validate(state: AppState) {
    if (!this.payload.activityInstanceId) {
      return { valid: false, error: 'activityInstanceId is required.' };
    }
    const task = state.tasks.find(t => t.id === this.payload.activityInstanceId);
    if (!task) {
      return { valid: false, error: `ActivityInstance ${this.payload.activityInstanceId} not found in tasks.` };
    }
    return { valid: true };
  }
}

export class PreparePerformanceSessionCommand implements ICommand {
  readonly type = 'PreparePerformanceSession';
  constructor(public payload: PreparePerformanceSessionPayload) {}

  validate(state: AppState) {
    if (!this.payload.sessionId) return { valid: false, error: 'sessionId is required.' };
    return { valid: true };
  }
}

export class ReadyPerformanceSessionCommand implements ICommand {
  readonly type = 'ReadyPerformanceSession';
  constructor(public payload: ReadyPerformanceSessionPayload) {}

  validate(state: AppState) {
    if (!this.payload.sessionId) return { valid: false, error: 'sessionId is required.' };
    return { valid: true };
  }
}

export class StartPerformanceSessionCommand implements ICommand {
  readonly type = 'StartPerformanceSession';
  constructor(public payload: StartPerformanceSessionPayload) {}

  validate(state: AppState) {
    if (!this.payload.sessionId) return { valid: false, error: 'sessionId is required.' };
    return { valid: true };
  }
}

export class PausePerformanceSessionCommand implements ICommand {
  readonly type = 'PausePerformanceSession';
  constructor(public payload: PausePerformanceSessionPayload) {}

  validate(state: AppState) {
    if (!this.payload.sessionId) return { valid: false, error: 'sessionId is required.' };
    return { valid: true };
  }
}

export class ResumePerformanceSessionCommand implements ICommand {
  readonly type = 'ResumePerformanceSession';
  constructor(public payload: ResumePerformanceSessionPayload) {}

  validate(state: AppState) {
    if (!this.payload.sessionId) return { valid: false, error: 'sessionId is required.' };
    return { valid: true };
  }
}

export class AdvancePerformanceStepCommand implements ICommand {
  readonly type = 'AdvancePerformanceStep';
  constructor(public payload: AdvancePerformanceStepPayload) {}

  validate(state: AppState) {
    if (!this.payload.sessionId) return { valid: false, error: 'sessionId is required.' };
    if (this.payload.stepIndex === undefined || this.payload.stepIndex < 0) {
      return { valid: false, error: 'Valid non-negative stepIndex is required.' };
    }
    return { valid: true };
  }
}

export class AttachPerformanceArtifactCommand implements ICommand {
  readonly type = 'AttachPerformanceArtifact';
  constructor(public payload: AttachPerformanceArtifactPayload) {}

  validate(state: AppState) {
    if (!this.payload.sessionId) return { valid: false, error: 'sessionId is required.' };
    if (!this.payload.title) return { valid: false, error: 'Artifact title is required.' };
    return { valid: true };
  }
}

export class RecordPerformanceEvidenceCommand implements ICommand {
  readonly type = 'RecordPerformanceEvidence';
  constructor(public payload: RecordPerformanceEvidencePayload) {}

  validate(state: AppState) {
    if (!this.payload.sessionId) return { valid: false, error: 'sessionId is required.' };
    if (!this.payload.type) return { valid: false, error: 'Evidence type is required.' };
    return { valid: true };
  }
}

export class RequestPerformanceExtensionCommand implements ICommand {
  readonly type = 'RequestPerformanceExtension';
  constructor(public payload: RequestPerformanceExtensionPayload) {}

  validate(state: AppState) {
    if (!this.payload.sessionId) return { valid: false, error: 'sessionId is required.' };
    if (!this.payload.requestedMinutes || this.payload.requestedMinutes <= 0) {
      return { valid: false, error: 'Positive requestedMinutes required.' };
    }
    return { valid: true };
  }
}

export class ClosePerformanceSessionCommand implements ICommand {
  readonly type = 'ClosePerformanceSession';
  constructor(public payload: ClosePerformanceSessionPayload) {}

  validate(state: AppState) {
    if (!this.payload.sessionId) return { valid: false, error: 'sessionId is required.' };
    if (!['COMPLETED', 'PARTIAL', 'BLOCKED', 'ABANDONED'].includes(this.payload.outcome)) {
      return { valid: false, error: `Invalid outcome: ${this.payload.outcome}` };
    }
    return { valid: true };
  }
}

export class CancelPerformanceSessionCommand implements ICommand {
  readonly type = 'CancelPerformanceSession';
  constructor(public payload: CancelPerformanceSessionPayload) {}

  validate(state: AppState) {
    if (!this.payload.sessionId) return { valid: false, error: 'sessionId is required.' };
    return { valid: true };
  }
}


