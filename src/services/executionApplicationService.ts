import { AppState, RoutineTask, SystemMode, DayType, AutonomyLevel, TomorrowPlan, UserOverrideRecord } from '../types';
import { IExecutionRepository, defaultExecutionRepository } from '../repositories';
import { IClock, getClockForState } from '../clock';
import { TransactionPipeline } from '../commands/transactionPipeline';
import { ICommand, CommandResult, CompleteActivityPayload, AdjustActivityPayload, OverrideActivityPayload, ActivateDayPayload } from '../commands/types';
import {
  PlanTomorrowCommand,
  ActivateDayCommand,
  StartActivityCommand,
  PauseActivityCommand,
  ResumeActivityCommand,
  CompleteActivityCommand,
  AdjustActivityCommand,
  AdvanceActivityCommand,
  DeferActivityCommand,
  CompressActivityCommand,
  ReplaceActivityCommand,
  OverrideActivityCommand,
  RecalculateDayCommand,
  ApproveDecisionCommand,
  RejectDecisionCommand,
  PauseAutonomyCommand,
  ResumeAutonomyCommand,
  SetSystemModeCommand,
  SetDayTypeCommand,
  SetSimulatedTimeCommand,
  TriggerFallbackCommand,
  ApplyAdaptationProposalCommand,
  RollbackAdaptationProposalCommand,
  RetainAdaptationProposalCommand,
  RejectAdaptationProposalCommand,
  EvaluateAdaptationMeasurementCommand,
  AcceptDisciplinePenaltyCommand,
  RecordTradingProtocolCommand,
  RecordCompanyOfTheDayCommand,
  RecordDailyReviewCommand,
  RecordIdentityStatusCommand,
  CreatePerformanceSessionCommand,
  PreparePerformanceSessionCommand,
  ReadyPerformanceSessionCommand,
  StartPerformanceSessionCommand,
  PausePerformanceSessionCommand,
  ResumePerformanceSessionCommand,
  AdvancePerformanceStepCommand,
  AttachPerformanceArtifactCommand,
  RecordPerformanceEvidenceCommand,
  RequestPerformanceExtensionCommand,
  ClosePerformanceSessionCommand,
  CancelPerformanceSessionCommand,
  RedeemRewardCommand,
  SetHOSOperatingPlanCommand,
  ResolveScheduleProposalCommand,
  UpsertExternalExecutionGateCommand
} from '../commands/commands';

/**
 * ExecutionApplicationService:
 * The authoritative application layer mediating between UI / external consumers and the HEE domain.
 * Enforces transactional execution through commands and repositories.
 */
export class ExecutionApplicationService {
  private pipeline: TransactionPipeline;
  private repository: IExecutionRepository;
  private clock?: IClock;

  constructor(repository: IExecutionRepository = defaultExecutionRepository, clock?: IClock) {
    this.repository = repository;
    this.clock = clock;
    this.pipeline = new TransactionPipeline(repository, clock);
  }

  async dispatch<TData = any>(command: ICommand<TData>, currentState?: AppState): Promise<CommandResult<TData>> {
    return this.pipeline.execute(command, currentState, {
      repository: this.repository,
      clock: this.clock,
    });
  }

  /**
   * Universal command execution accepting either an ICommand instance or a command descriptor { type, payload }
   */
  async execute<TData = any>(
    commandOrDescriptor: ICommand<TData> | { type: string; payload?: any },
    currentState?: AppState
  ): Promise<CommandResult<TData>> {
    if ('validate' in commandOrDescriptor && typeof (commandOrDescriptor as any).validate === 'function') {
      return this.dispatch(commandOrDescriptor as ICommand<TData>, currentState);
    }

    const desc = commandOrDescriptor as { type: string; payload?: any };
    let command: ICommand;

    switch (desc.type) {
      case 'CreatePerformanceSession':
        command = new CreatePerformanceSessionCommand(desc.payload);
        break;
      case 'PreparePerformanceSession':
        command = new PreparePerformanceSessionCommand(desc.payload);
        break;
      case 'ReadyPerformanceSession':
        command = new ReadyPerformanceSessionCommand(desc.payload);
        break;
      case 'StartPerformanceSession':
        command = new StartPerformanceSessionCommand(desc.payload);
        break;
      case 'PausePerformanceSession':
        command = new PausePerformanceSessionCommand(desc.payload);
        break;
      case 'ResumePerformanceSession':
        command = new ResumePerformanceSessionCommand(desc.payload);
        break;
      case 'AdvancePerformanceStep':
        command = new AdvancePerformanceStepCommand(desc.payload);
        break;
      case 'AttachPerformanceArtifact':
        command = new AttachPerformanceArtifactCommand(desc.payload);
        break;
      case 'RecordPerformanceEvidence':
        command = new RecordPerformanceEvidenceCommand(desc.payload);
        break;
      case 'RequestPerformanceExtension':
        command = new RequestPerformanceExtensionCommand(desc.payload);
        break;
      case 'ClosePerformanceSession':
        command = new ClosePerformanceSessionCommand(desc.payload);
        break;
      case 'CancelPerformanceSession':
        command = new CancelPerformanceSessionCommand(desc.payload);
        break;
      case 'AcceptDisciplinePenalty':
        command = new AcceptDisciplinePenaltyCommand(desc.payload);
        break;
      case 'RedeemReward':
        command = new RedeemRewardCommand(desc.payload);
        break;
      case 'SetHOSOperatingPlan':
        command = new SetHOSOperatingPlanCommand(desc.payload);
        break;
      case 'ResolveScheduleProposal':
        command = new ResolveScheduleProposalCommand(desc.payload);
        break;
      case 'UpsertExternalExecutionGate':
        command = new UpsertExternalExecutionGateCommand(desc.payload);
        break;
      case 'CompleteActivity':
        command = new CompleteActivityCommand(desc.payload);
        break;
      case 'StartActivity':
        command = new StartActivityCommand(desc.payload);
        break;
      case 'PauseActivity':
        command = new PauseActivityCommand(desc.payload);
        break;
      case 'ResumeActivity':
        command = new ResumeActivityCommand(desc.payload);
        break;
      default:
        throw new Error(`Unknown command type: ${desc.type}`);
    }

    return this.dispatch(command, currentState);
  }

  async setHOSOperatingPlan(plan: import('../types').HOSDailyOperatingPlan, currentState?: AppState): Promise<CommandResult> {
    return this.dispatch(new SetHOSOperatingPlanCommand({ plan }), currentState);
  }

  async resolveScheduleProposal(proposalId: string, decision: 'ACCEPT' | 'REJECT', currentState?: AppState): Promise<CommandResult> {
    return this.dispatch(new ResolveScheduleProposalCommand({ proposalId, decision }), currentState);
  }

  async upsertExternalExecutionGate(gate: import('../types').ExternalExecutionGate, currentState?: AppState): Promise<CommandResult> {
    return this.dispatch(new UpsertExternalExecutionGateCommand({ gate }), currentState);
  }

  async planTomorrow(plan: Partial<TomorrowPlan>, currentState?: AppState): Promise<CommandResult> {
    return this.dispatch(new PlanTomorrowCommand({ plan }), currentState);
  }

  async activateDay(payload: ActivateDayPayload = {}, currentState?: AppState): Promise<CommandResult> {
    return this.dispatch(new ActivateDayCommand(payload), currentState);
  }

  async startActivity(taskId: string, currentState?: AppState): Promise<CommandResult> {
    return this.dispatch(new StartActivityCommand({ taskId }), currentState);
  }

  async pauseActivity(taskId: string, reason?: string, currentState?: AppState): Promise<CommandResult> {
    return this.dispatch(new PauseActivityCommand({ taskId, reason }), currentState);
  }

  async resumeActivity(taskId: string, currentState?: AppState): Promise<CommandResult> {
    return this.dispatch(new ResumeActivityCommand({ taskId }), currentState);
  }

  async completeActivity(payload: CompleteActivityPayload, currentState?: AppState): Promise<CommandResult> {
    return this.dispatch(new CompleteActivityCommand(payload), currentState);
  }

  async adjustActivity(payload: AdjustActivityPayload, currentState?: AppState): Promise<CommandResult> {
    return this.dispatch(new AdjustActivityCommand(payload), currentState);
  }

  async advanceActivity(taskId: string, minutes: number, reason: string, currentState?: AppState): Promise<CommandResult> {
    return this.dispatch(new AdvanceActivityCommand({ taskId, minutes, reason }), currentState);
  }

  async deferActivity(taskId: string, minutes: number, reason: string, currentState?: AppState): Promise<CommandResult> {
    return this.dispatch(new DeferActivityCommand({ taskId, minutes, reason }), currentState);
  }

  async compressActivity(taskId: string, targetDurationMinutes: number, reason: string, fallbackTierLevel?: number, currentState?: AppState): Promise<CommandResult> {
    return this.dispatch(new CompressActivityCommand({ taskId, targetDurationMinutes, reason, fallbackTierLevel }), currentState);
  }

  async replaceActivity(taskId: string, replacementTaskId: string, reason: string, currentState?: AppState): Promise<CommandResult> {
    return this.dispatch(new ReplaceActivityCommand({ taskId, replacementTaskId, reason }), currentState);
  }

  async overrideActivity(payload: OverrideActivityPayload, currentState?: AppState): Promise<CommandResult> {
    return this.dispatch(new OverrideActivityCommand(payload), currentState);
  }

  async recalculateDay(force: boolean = false, reason?: string, currentState?: AppState): Promise<CommandResult> {
    return this.dispatch(new RecalculateDayCommand({ force, reason }), currentState);
  }

  async approveDecision(decisionId: string, optionId: string, currentState?: AppState): Promise<CommandResult> {
    return this.dispatch(new ApproveDecisionCommand({ decisionId, optionId }), currentState);
  }

  async rejectDecision(decisionId: string, reason?: string, currentState?: AppState): Promise<CommandResult> {
    return this.dispatch(new RejectDecisionCommand({ decisionId, reason }), currentState);
  }

  async pauseAutonomy(reason?: string, currentState?: AppState): Promise<CommandResult> {
    return this.dispatch(new PauseAutonomyCommand({ reason }), currentState);
  }

  async resumeAutonomy(targetLevel?: AutonomyLevel, currentState?: AppState): Promise<CommandResult> {
    return this.dispatch(new ResumeAutonomyCommand({ targetLevel }), currentState);
  }

  async setSystemMode(mode: SystemMode, currentState?: AppState): Promise<CommandResult> {
    return this.dispatch(new SetSystemModeCommand({ mode }), currentState);
  }

  async setDayType(dayType: DayType, currentState?: AppState): Promise<CommandResult> {
    return this.dispatch(new SetDayTypeCommand({ dayType }), currentState);
  }

  async setSimulatedTime(isSimulatedTime: boolean, simulatedTime: string, currentState?: AppState): Promise<CommandResult> {
    return this.dispatch(new SetSimulatedTimeCommand({ isSimulatedTime, simulatedTime }), currentState);
  }

  async triggerFallback(taskId: string, targetTierLevel: number, reason?: string, currentState?: AppState): Promise<CommandResult> {
    return this.dispatch(new TriggerFallbackCommand({ taskId, targetTierLevel, reason }), currentState);
  }

  async applyAdaptationProposal(proposalId: string, currentState?: AppState): Promise<CommandResult> {
    return this.dispatch(new ApplyAdaptationProposalCommand({ proposalId }), currentState);
  }

  async rollbackAdaptationProposal(proposalId: string, reason?: string, currentState?: AppState): Promise<CommandResult> {
    return this.dispatch(new RollbackAdaptationProposalCommand({ proposalId, reason }), currentState);
  }

  async retainAdaptationProposal(proposalId: string, currentState?: AppState): Promise<CommandResult> {
    return this.dispatch(new RetainAdaptationProposalCommand({ proposalId }), currentState);
  }

  async rejectAdaptationProposal(proposalId: string, currentState?: AppState): Promise<CommandResult> {
    return this.dispatch(new RejectAdaptationProposalCommand({ proposalId }), currentState);
  }

  async evaluateAdaptationMeasurement(proposalId: string, currentState?: AppState): Promise<CommandResult> {
    return this.dispatch(new EvaluateAdaptationMeasurementCommand({ proposalId }), currentState);
  }

  async acceptDisciplinePenalty(taskId: string, penaltyPoints?: number, currentState?: AppState): Promise<CommandResult> {
    return this.dispatch(new AcceptDisciplinePenaltyCommand({ taskId, penaltyPoints }), currentState);
  }

  async redeemReward(rewardId: string, currentState?: AppState): Promise<CommandResult> {
    return this.dispatch(new RedeemRewardCommand({ rewardId }), currentState);
  }

  async reconcileLifecycle(options?: { forceDayBoundary?: boolean; targetMinutes?: number }, currentState?: AppState): Promise<AppState> {
    const state = currentState || await this.repository.loadState();
    const { reconcileLifecycleState } = await import('./reconciliationEngine');
    const reconciliation = reconcileLifecycleState(state, this.clock, options);
    await this.repository.saveState(reconciliation.state);
    return reconciliation.state;
  }
}

export const defaultApplicationService = new ExecutionApplicationService(defaultExecutionRepository);
