import { AppState, RoutineTask, SystemEvent, UserOverrideRecord } from '../types';
import { IClock, getClockForState } from '../clock';
import { IExecutionRepository, defaultExecutionRepository } from '../repositories';
import { ICommand, CommandResult, CommandContext } from './types';
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
  LateWakeRecoveryCommand,
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
  UpsertExternalExecutionGateCommand,
  UpsertHOSHumanStateContextCommand,
  ReceivePDIEExecutionRecommendationCommand
} from './commands';
import { HumanPerformanceEngine } from '../services/performanceEngine';
import { evaluateRoutineState } from '../services/routineEngine';
import { calculateDynamicAllocations } from '../services/allocationEngine';
import { scanAndResolveDeviations } from '../services/deviationEngine';
import { getAutonomousNextDecision } from '../services/decisionEngine';
import { checkTaskDependencies } from '../services/dependencyEngine';
import { selectOptimalFallbackTier } from '../services/fallbackEngine';
import { createSystemEvent } from '../services/eventBus';
import { PENALTY_POINTS_MISSED_WINDOW } from '../services/storageService';
import { defaultDurableEventStore } from '../services/durableEventStore';
import { defaultEventDispatcher } from '../services/eventDispatcher';
import {
  evaluateTomorrowFeasibility,
  activateTomorrowIntent,
  executeLateWakeRecovery
} from '../services/tomorrowPlanningEngine';
import {
  applyAdaptationProposal,
  rollbackAdaptationProposal,
  retainAdaptationProposal,
  rejectAdaptationProposal,
  measureAdaptationPerformance
} from '../services/adaptationEngine';
import { upsertDailyPerformanceRecord, reconcileWeeklyPerformance, generateWeeklyAdaptationRecommendations } from '../services/weeklyPerformanceIntelligence';
import { reconcileAllocationPlanWithAuthority, requestSingleActivityScheduleChange, acceptHOSDailyOperatingPlan, resolveHOSScheduleProposal } from '../services/scheduleAuthority';
import { applyLegacyTradingProtocolUpdate } from '../adapters/legacyTradingCompatibilityAdapter';
import { upsertExternalExecutionGate } from '../services/externalExecutionGate';
import { acceptHOSHumanStateContext, acceptPDIEExecutionRecommendation, projectExecutionBehavioralSignal, recordBehavioralSignal } from '../hos/humanStateDecisionBridge';

/**
 * TransactionPipeline / Command Bus:
 * Orchestrates the authoritative transactional lifecycle:
 * COMMAND -> validation -> governance -> domain execution -> repository persistence -> event creation -> resulting state -> UI
 */
export class TransactionPipeline {
  private repository: IExecutionRepository;
  private defaultClock?: IClock;

  constructor(repository: IExecutionRepository = defaultExecutionRepository, clock?: IClock) {
    this.repository = repository;
    this.defaultClock = clock;
  }

  async execute<TData = any>(
    command: ICommand<TData>,
    currentState?: AppState,
    customContext?: Partial<CommandContext>
  ): Promise<CommandResult<TData>> {
    // 1. Resolve starting state and execution context
    let state: AppState = currentState
      ? JSON.parse(JSON.stringify(currentState))
      : await this.repository.loadState();

    const clock = customContext?.clock || getClockForState(state, this.defaultClock);
    const repository = customContext?.repository || this.repository;
    const context: CommandContext = { clock, repository, unitOfWork: customContext?.unitOfWork };

    const currentMinutes = clock.getCurrentTimeMinutes();
    const performanceEngine = new HumanPerformanceEngine(clock);
    const createdEvents: SystemEvent[] = [];

    // 2. VALIDATION STAGE
    if (command.validate) {
      const validation = command.validate(state, context);
      if (!validation.valid) {
        return {
          success: false,
          state,
          events: [],
          error: validation.error || 'Command validation failed',
        };
      }
    }

    // 3. GOVERNANCE STAGE
    if (command.authorize) {
      const auth = command.authorize(state, context);
      if (!auth.authorized) {
        return {
          success: false,
          state,
          events: [],
          error: auth.reason || 'Governance authorization rejected command execution',
        };
      }
    }

    // 4. DOMAIN EXECUTION STAGE
    let domainSuccess = true;
    let failureReason: string | undefined;

    try {
      if (command instanceof SetHOSOperatingPlanCommand) {
        state = acceptHOSDailyOperatingPlan(state, command.payload.plan);
        createdEvents.push(createSystemEvent(
          'HOSOperatingPlanReceived',
          command.payload.plan.planId,
          {
            planId: command.payload.plan.planId,
            planVersion: command.payload.plan.planVersion,
            subjectId: command.payload.plan.subjectId,
            localDate: command.payload.plan.localDate,
            delegatedWindowsCount: command.payload.plan.delegatedWindows.length,
            commitmentsCount: command.payload.plan.commitments.length,
          },
          state,
          'SYSTEM_KERNEL',
          undefined,
          clock
        ));
      } else if (command instanceof ResolveScheduleProposalCommand) {
        state = resolveHOSScheduleProposal(state, command.payload.proposalId, command.payload.decision);
        createdEvents.push(createSystemEvent(
          command.payload.decision === 'ACCEPT' ? 'ScheduleProposalAccepted' : 'ScheduleProposalRejected',
          command.payload.proposalId,
          { decision: command.payload.decision },
          state,
          'GOVERNANCE_GUARD',
          undefined,
          clock
        ));
      } else if (command instanceof UpsertExternalExecutionGateCommand) {
        state = upsertExternalExecutionGate(state, command.payload.gate);
        createdEvents.push(createSystemEvent(
          'ExternalExecutionGateUpdated',
          command.payload.gate.id,
          command.payload.gate,
          state,
          'SYSTEM_KERNEL',
          undefined,
          clock
        ));
      } else if (command instanceof UpsertHOSHumanStateContextCommand) {
        state = acceptHOSHumanStateContext(state, command.payload.context);
        createdEvents.push(createSystemEvent(
          'HOSHumanStateContextUpdated',
          command.payload.context.contextId,
          {
            contextId: command.payload.context.contextId,
            subjectId: command.payload.context.subjectId,
            sourceRef: command.payload.context.sourceRef,
            observedAtUtc: command.payload.context.observedAtUtc,
            validUntilUtc: command.payload.context.validUntilUtc,
            confidence: command.payload.context.confidence,
          },
          state,
          'SYSTEM_KERNEL',
          undefined,
          clock
        ));
      } else if (command instanceof ReceivePDIEExecutionRecommendationCommand) {
        state = acceptPDIEExecutionRecommendation(state, command.payload.recommendation);
        createdEvents.push(createSystemEvent(
          'PDIERecommendationReceived',
          command.payload.recommendation.id,
          {
            recommendationId: command.payload.recommendation.id,
            subjectId: command.payload.recommendation.subjectId,
            type: command.payload.recommendation.type,
            confidence: command.payload.recommendation.confidence,
            evidenceRefs: command.payload.recommendation.evidenceRefs,
            expiresAtUtc: command.payload.recommendation.expiresAtUtc,
          },
          state,
          'SYSTEM_KERNEL',
          undefined,
          clock
        ));
        createdEvents.push(createSystemEvent(
          'PDIERecommendationProjected',
          command.payload.recommendation.id,
          {
            recommendationId: command.payload.recommendation.id,
            projection: 'EXECUTION_ADVISORY_CONTEXT',
            policyMutation: false,
            hsvMutation: false,
          },
          state,
          'GOVERNANCE_GUARD',
          undefined,
          clock
        ));
      } else if (command instanceof PlanTomorrowCommand) {
        state.tomorrowPlan = {
          ...state.tomorrowPlan,
          ...command.payload.plan,
        };
        const feasibility = evaluateTomorrowFeasibility(state.tomorrowPlan, state);
        state.tomorrowPlan.lastFeasibilityResult = feasibility;
        state.tomorrowPlan.lastPlannedAt = command.payload.plan.lastPlannedAt || clock.toISOString();

        const evt1 = createSystemEvent(
          'TomorrowPlanned',
          'tomorrowPlan',
          {
            plan: command.payload.plan,
            feasibilityScore: feasibility.feasibilityScore,
            predictedMode: feasibility.predictedMode,
            predictedDayType: feasibility.predictedDayType,
            conflictsCount: feasibility.conflicts.length,
          },
          state,
          'USER',
          undefined,
          clock
        );
        const evt2 = createSystemEvent(
          'ActivityScheduled',
          'tomorrowPlan',
          {
            plan: command.payload.plan,
            top3: state.tomorrowPlan.top3,
          },
          state,
          'USER',
          undefined,
          clock
        );
        createdEvents.push(evt1, evt2);
      } else if (command instanceof ActivateDayCommand) {
        const activation = activateTomorrowIntent(state, {
          ...(command.payload.mode ? { desiredRoutine: command.payload.mode === 'RED' ? 'RECOVERY' : command.payload.mode === 'YELLOW' ? 'COMPRESSED' : 'STANDARD' } : {}),
        }, clock);
        state = activation.state;
        if (command.payload.mode) {
          state.currentMode = command.payload.mode;
        }
        if (command.payload.dayType) {
          state.dayType = command.payload.dayType;
        }
        createdEvents.push(...activation.events);
      } else if (command instanceof LateWakeRecoveryCommand) {
        const recovery = executeLateWakeRecovery(state, command.payload.actualWakeMinutes, clock);
        state = recovery.state;
        createdEvents.push(...recovery.events);
      } else if (command instanceof StartActivityCommand) {
        const taskId = command.payload.taskId;
        const task = state.tasks.find(t => t.id === taskId);
        if (task) {
          // Check dependencies
          const depCheck = checkTaskDependencies(state, task.id);
          if (depCheck.isBlocked && depCheck.blockingReasons.length > 0) {
            // Log deviation if blocked
            const devId = `dev-blocked-${Date.now()}`;
            state.deviations = [
              {
                id: devId,
                timestamp: clock.toISOString(),
                activityId: task.id,
                type: 'BLOCKED',
                severity: 'HIGH',
                likelyCause: `Dependency constraint not satisfied: ${depCheck.blockingReasons.join(', ')}`,
                impactSummary: 'Activity cannot safely commence without prerequisite completion.',
                isResolved: false,
                resolvedAutonomously: false,
              },
              ...(state.deviations || []),
            ];
          }

          state.tasks = state.tasks.map(t =>
            t.id === taskId
              ? {
                  ...t,
                  executionStatus: 'PENDING',
                }
              : t
          );

          const evt = createSystemEvent('ActivityStarted', taskId, { currentMinutes }, state, 'USER', undefined, clock);
          createdEvents.push(evt);
        }
      } else if (command instanceof PauseActivityCommand) {
        const taskId = command.payload.taskId;
        const evt = createSystemEvent('ExecutionInterrupted', taskId, { reason: command.payload.reason || 'User paused activity' }, state, 'USER', undefined, clock);
        createdEvents.push(evt);
      } else if (command instanceof ResumeActivityCommand) {
        const taskId = command.payload.taskId;
        const evt = createSystemEvent('ExecutionStarted', taskId, { currentMinutes }, state, 'USER', undefined, clock);
        createdEvents.push(evt);
      } else if (command instanceof CompleteActivityCommand) {
        const { taskId, executionStatus, missedWindow, penaltyCutPoints, completedAtMinutes } = command.payload;
        const completionTime = completedAtMinutes !== undefined ? completedAtMinutes : currentMinutes;

        // Completion must respect generic dependencies and external-domain execution gates.
        const completionGate = checkTaskDependencies(state, taskId);
        if (completionGate.isBlocked) {
          throw new Error(`EXECUTION_GATE_BLOCKED: ${completionGate.blockingReasons.join('; ')}`);
        }

        const task = state.tasks.find(t => t.id === taskId);
        if (task) {
          const finalStatus = executionStatus || (task.endMinutes + 5 < completionTime ? 'MISSED_LATE' : 'ON_TIME');
          const isMissed = missedWindow !== undefined ? missedWindow : finalStatus === 'MISSED_LATE';
          const penalty = penaltyCutPoints || (isMissed ? PENALTY_POINTS_MISSED_WINDOW : 0);

          state.tasks = state.tasks.map(t =>
            t.id === taskId
              ? {
                  ...t,
                  completed: true,
                  completedAtMinutes: completionTime,
                  completedAtDate: clock.toISOString(),
                  executionStatus: finalStatus,
                  missedWindow: isMissed,
                  penaltyCutPoints: penalty,
                }
              : t
          );

          // Award points if not already awarded
          const alreadyAwarded = (state.pointsAwardedTasks || []).includes(taskId);
          if (!alreadyAwarded) {
            let pointsGained = 10;
            if (task.isNonNegotiable) pointsGained += 10;
            if (isMissed) pointsGained = Math.max(0, pointsGained - penalty);
            state.rewardPoints = (state.rewardPoints || 0) + pointsGained;
            state.pointsAwardedTasks = [...(state.pointsAwardedTasks || []), taskId];
          }

          // Calculate bounded execution reallocations. HOS remains authoritative when connected.
          const allocs = calculateDynamicAllocations(state);
          const scheduleDecision = reconcileAllocationPlanWithAuthority(
            state,
            allocs.allocations,
            allocs.recalculatedTasks,
            allocs.reallocationReason
          );
          state = scheduleDecision.state;
          if (scheduleDecision.proposal) {
            createdEvents.push(createSystemEvent(
              'ScheduleProposalCreated',
              scheduleDecision.proposal.id,
              scheduleDecision.proposal,
              state,
              'SYSTEM_KERNEL',
              undefined,
              clock
            ));
          }

          const routineEval = evaluateRoutineState(state);
          state.routineState = routineEval.routineState;
          if (routineEval.reason) state.routineChangeReason = routineEval.reason;

          const evt = createSystemEvent('ActivityCompleted', taskId, { completedAtMinutes: completionTime, executionStatus: finalStatus }, state, 'USER', undefined, clock);
          createdEvents.push(evt);
        }
      } else if (command instanceof AdjustActivityCommand) {
        const { taskId, startMinutes, endMinutes } = command.payload;
        const task = state.tasks.find(t => t.id === taskId);
        if (task) {
          const nextStart = startMinutes ?? task.allocatedStartMinutes ?? task.startMinutes;
          const nextEnd = endMinutes ?? task.allocatedEndMinutes ?? task.endMinutes;
          const change = requestSingleActivityScheduleChange(
            state,
            taskId,
            nextStart,
            nextEnd,
            'User requested an execution schedule adjustment.',
            'REALLOCATE'
          );
          state = change.state;
          const evt = createSystemEvent(
            change.applied ? 'AllocationChanged' : 'ScheduleProposalCreated',
            change.proposal?.id || taskId,
            { taskId, startMinutes: nextStart, endMinutes: nextEnd, reason: change.reason },
            state,
            'USER',
            undefined,
            clock
          );
          createdEvents.push(evt);
        }
      } else if (command instanceof AdvanceActivityCommand) {
        const { taskId, minutes, reason } = command.payload;
        const task = state.tasks.find(t => t.id === taskId);
        if (task) {
          const oldStart = task.allocatedStartMinutes ?? task.startMinutes;
          const oldEnd = task.allocatedEndMinutes ?? task.endMinutes;
          const nextStart = Math.max(0, oldStart - minutes);
          const nextEnd = Math.max(nextStart + 1, oldEnd - minutes);
          const change = requestSingleActivityScheduleChange(
            state,
            taskId,
            nextStart,
            nextEnd,
            reason,
            'REALLOCATE'
          );
          state = change.state;
          const overrideRecord: UserOverrideRecord = {
            id: `ovr-${Date.now()}`,
            timestamp: clock.toISOString(),
            activityId: taskId,
            overrideType: 'ADVANCE',
            reason,
            previousState: { start: oldStart, end: oldEnd },
            newState: change.applied
              ? { start: nextStart, end: nextEnd }
              : { proposalId: change.proposal?.id, proposedStart: nextStart, proposedEnd: nextEnd },
          };
          state.userOverrides = [overrideRecord, ...(state.userOverrides || [])];
          createdEvents.push(createSystemEvent(
            change.applied ? 'OverrideCreated' : 'ScheduleProposalCreated',
            change.proposal?.id || taskId,
            overrideRecord,
            state,
            'USER',
            undefined,
            clock
          ));
        }
      } else if (command instanceof DeferActivityCommand) {
        const { taskId, minutes, reason } = command.payload;
        const task = state.tasks.find(t => t.id === taskId);
        if (task) {
          const oldStart = task.allocatedStartMinutes ?? task.startMinutes;
          const oldEnd = task.allocatedEndMinutes ?? task.endMinutes;
          const nextStart = Math.min(1439, oldStart + minutes);
          const nextEnd = Math.min(1440, oldEnd + minutes);
          const change = requestSingleActivityScheduleChange(
            state,
            taskId,
            nextStart,
            nextEnd,
            reason,
            'DEFER'
          );
          state = change.state;
          const overrideRecord: UserOverrideRecord = {
            id: `ovr-${Date.now()}`,
            timestamp: clock.toISOString(),
            activityId: taskId,
            overrideType: 'DEFER',
            reason,
            previousState: { start: oldStart, end: oldEnd },
            newState: change.applied
              ? { start: nextStart, end: nextEnd }
              : { proposalId: change.proposal?.id, proposedStart: nextStart, proposedEnd: nextEnd },
          };
          state.userOverrides = [overrideRecord, ...(state.userOverrides || [])];
          createdEvents.push(createSystemEvent(
            change.applied ? 'OverrideCreated' : 'ScheduleProposalCreated',
            change.proposal?.id || taskId,
            overrideRecord,
            state,
            'USER',
            undefined,
            clock
          ));
        }
      } else if (command instanceof CompressActivityCommand) {
        const { taskId, targetDurationMinutes, reason, fallbackTierLevel } = command.payload;
        const task = state.tasks.find(t => t.id === taskId);
        if (task) {
          const start = task.allocatedStartMinutes ?? task.startMinutes;
          const end = Math.min(1440, start + targetDurationMinutes);
          const change = requestSingleActivityScheduleChange(
            state,
            taskId,
            start,
            end,
            reason,
            'COMPRESS'
          );
          state = change.state;
          if (change.applied) {
            const targetLevel = fallbackTierLevel !== undefined ? fallbackTierLevel : 1;
            state.tasks = state.tasks.map(t => t.id === taskId
              ? { ...t, fallbackLevel: targetLevel, executionStatus: 'COMPRESSED' }
              : t
            );
          }
          createdEvents.push(createSystemEvent(
            change.applied ? 'FallbackTriggered' : 'ScheduleProposalCreated',
            change.proposal?.id || taskId,
            { targetDurationMinutes, reason, applied: change.applied },
            state,
            'USER',
            undefined,
            clock
          ));
        }
      } else if (command instanceof ReplaceActivityCommand) {
        const { taskId, replacementTaskId, reason } = command.payload;
        const targetTask = state.tasks.find(t => t.id === taskId);
        const replacementDef = state.activities.find(a => a.id === replacementTaskId);

        if (targetTask && replacementDef) {
          state.tasks = state.tasks.map(t =>
            t.id === taskId
              ? {
                  ...t,
                  title: replacementDef.title,
                  subtext: replacementDef.objective,
                  notes: `Replaced by ${replacementDef.title}: ${reason}`,
                }
              : t
          );
          const overrideRecord: UserOverrideRecord = {
            id: `ovr-${Date.now()}`,
            timestamp: clock.toISOString(),
            activityId: taskId,
            overrideType: 'REPLACE',
            reason,
            previousState: targetTask.title,
            newState: replacementDef.title,
          };
          state.userOverrides = [overrideRecord, ...(state.userOverrides || [])];
          const evt = createSystemEvent('OverrideCreated', taskId, overrideRecord, state, 'USER', undefined, clock);
          createdEvents.push(evt);
        }
      } else if (command instanceof OverrideActivityCommand) {
        const { taskId, overrideType, reason, modifications } = command.payload;
        const prevTask = state.tasks.find(t => t.id === taskId);
        if (prevTask) {
          if (modifications) {
            state.tasks = state.tasks.map(t => (t.id === taskId ? { ...t, ...modifications } : t));
          }
          const overrideRecord: UserOverrideRecord = {
            id: `ovr-${Date.now()}`,
            timestamp: clock.toISOString(),
            activityId: taskId,
            overrideType,
            reason,
            previousState: prevTask,
            newState: modifications || overrideType,
          };
          state.userOverrides = [overrideRecord, ...(state.userOverrides || [])];
          const evt = createSystemEvent('OverrideCreated', taskId, overrideRecord, state, 'USER', undefined, clock);
          createdEvents.push(evt);
        }
      } else if (command instanceof RecalculateDayCommand) {
        const devScan = scanAndResolveDeviations(state);
        state = devScan.updatedState;

        const allocs = calculateDynamicAllocations(state);
        const scheduleDecision = reconcileAllocationPlanWithAuthority(
          state,
          allocs.allocations,
          allocs.recalculatedTasks,
          command.payload.reason || allocs.reallocationReason
        );
        state = scheduleDecision.state;

        const routineEval = evaluateRoutineState(state);
        state.routineState = routineEval.routineState;
        if (routineEval.reason) state.routineChangeReason = routineEval.reason;

        const nextDecision = getAutonomousNextDecision(state);
        if (nextDecision.decisionReason) state.lastDecisionReason = nextDecision.decisionReason;

        createdEvents.push(createSystemEvent(
          scheduleDecision.applied ? 'AllocationChanged' : 'ScheduleProposalCreated',
          scheduleDecision.proposal?.id || 'daySchedule',
          {
            currentMinutes,
            reason: scheduleDecision.reason,
            proposalId: scheduleDecision.proposal?.id,
          },
          state,
          'SYSTEM_KERNEL',
          undefined,
          clock
        ));
      } else if (command instanceof ApproveDecisionCommand) {
        const { decisionId, optionId } = command.payload;
        state.activeHumanDecision = null;
        state.lastDecisionReason = `Approved decision ${decisionId} with option ${optionId}`;
        const evt = createSystemEvent('HumanDecisionReceived', decisionId, { optionId, approved: true }, state, 'USER', undefined, clock);
        createdEvents.push(evt);
      } else if (command instanceof RejectDecisionCommand) {
        const { decisionId, reason } = command.payload;
        state.activeHumanDecision = null;
        state.lastDecisionReason = `Rejected decision ${decisionId}: ${reason || 'User rejected'}`;
        const evt = createSystemEvent('HumanDecisionReceived', decisionId, { reason, approved: false }, state, 'USER', undefined, clock);
        createdEvents.push(evt);
      } else if (command instanceof PauseAutonomyCommand) {
        state.autonomyLevel = 0;
        const evt = createSystemEvent('RoutineChanged', 'autonomy', { autonomyLevel: 0, reason: command.payload.reason || 'Autonomy paused by human (Manual Mode)' }, state, 'GOVERNANCE_GUARD', undefined, clock);
        createdEvents.push(evt);
      } else if (command instanceof ResumeAutonomyCommand) {
        state.autonomyLevel = command.payload.targetLevel !== undefined ? command.payload.targetLevel : 3;
        const evt = createSystemEvent('RoutineChanged', 'autonomy', { autonomyLevel: state.autonomyLevel }, state, 'GOVERNANCE_GUARD', undefined, clock);
        createdEvents.push(evt);
      } else if (command instanceof SetSystemModeCommand) {
        state.currentMode = command.payload.mode;
        const allocs = calculateDynamicAllocations(state);
        const scheduleDecision = reconcileAllocationPlanWithAuthority(
          state,
          allocs.allocations,
          allocs.recalculatedTasks,
          `Mode changed to ${command.payload.mode}; execution reallocation evaluated.`
        );
        state = scheduleDecision.state;
        const evt = createSystemEvent('RoutineChanged', 'mode', {
          mode: command.payload.mode,
          scheduleApplied: scheduleDecision.applied,
          proposalId: scheduleDecision.proposal?.id,
        }, state, 'USER', undefined, clock);
        createdEvents.push(evt);
      } else if (command instanceof SetDayTypeCommand) {
        state.dayType = command.payload.dayType;
        const allocs = calculateDynamicAllocations(state);
        const scheduleDecision = reconcileAllocationPlanWithAuthority(
          state,
          allocs.allocations,
          allocs.recalculatedTasks,
          `Day type changed to ${command.payload.dayType}; execution reallocation evaluated.`
        );
        state = scheduleDecision.state;
        const evt = createSystemEvent('RoutineChanged', 'dayType', {
          dayType: command.payload.dayType,
          scheduleApplied: scheduleDecision.applied,
          proposalId: scheduleDecision.proposal?.id,
        }, state, 'USER', undefined, clock);
        createdEvents.push(evt);
      } else if (command instanceof SetSimulatedTimeCommand) {
        state.isSimulatedTime = command.payload.isSimulatedTime;
        state.simulatedTime = command.payload.simulatedTime;
      } else if (command instanceof TriggerFallbackCommand) {
        const { taskId, targetTierLevel, reason } = command.payload;
        const policy = state.fallbackPolicies.find(p => p.activityId === taskId);
        if (policy) {
          const tier = policy.tiers.find(t => t.level === targetTierLevel) || policy.tiers[0];
          state.tasks = state.tasks.map(t =>
            t.id === taskId
              ? {
                  ...t,
                  fallbackLevel: tier.level,
                  executionStatus: tier.level > 0 ? 'FALLBACK_EXECUTED' : 'PENDING',
                }
              : t
          );
          const evt = createSystemEvent('FallbackTriggered', taskId, { targetTierLevel, reason: reason || tier.title }, state, 'SYSTEM_KERNEL', undefined, clock);
          createdEvents.push(evt);
        }
      } else if (command instanceof ApplyAdaptationProposalCommand) {
        state = applyAdaptationProposal(state, command.payload.proposalId, 'USER');
        const prop = (state.adaptationProposals || []).find(p => p.id === command.payload.proposalId);
        if (prop) {
          const evt = createSystemEvent('AdaptationApplied', prop.id, prop, state, 'USER', undefined, clock);
          createdEvents.push(evt);
        }
      } else if (command instanceof RollbackAdaptationProposalCommand) {
        state = rollbackAdaptationProposal(state, command.payload.proposalId, command.payload.reason, 'USER');
        const prop = (state.adaptationProposals || []).find(p => p.id === command.payload.proposalId);
        if (prop) {
          const evt = createSystemEvent('AdaptationRolledBack', prop.id, prop, state, 'USER', undefined, clock);
          createdEvents.push(evt);
        }
      } else if (command instanceof RetainAdaptationProposalCommand) {
        state = retainAdaptationProposal(state, command.payload.proposalId, 'USER');
        const prop = (state.adaptationProposals || []).find(p => p.id === command.payload.proposalId);
        if (prop) {
          const evt = createSystemEvent('AdaptationRetained', prop.id, prop, state, 'USER', undefined, clock);
          createdEvents.push(evt);
        }
      } else if (command instanceof RejectAdaptationProposalCommand) {
        state = rejectAdaptationProposal(state, command.payload.proposalId);
        const prop = (state.adaptationProposals || []).find(p => p.id === command.payload.proposalId);
        if (prop) {
          const evt = createSystemEvent('AdaptationRejected', prop.id, prop, state, 'USER', undefined, clock);
          createdEvents.push(evt);
        }
      } else if (command instanceof EvaluateAdaptationMeasurementCommand) {
        state = measureAdaptationPerformance(state, command.payload.proposalId);
        const prop = (state.adaptationProposals || []).find(p => p.id === command.payload.proposalId);
        if (prop) {
          const evt = createSystemEvent('AdaptationMeasured', prop.id, prop, state, 'SYSTEM_KERNEL', undefined, clock);
          createdEvents.push(evt);
        }
      } else if (command instanceof AcceptDisciplinePenaltyCommand) {
        const taskId = command.payload.taskId;
        const penalty = command.payload.penaltyPoints || PENALTY_POINTS_MISSED_WINDOW;
        state.tasks = state.tasks.map(t =>
          t.id === taskId
            ? {
                ...t,
                completed: true,
                completedAtMinutes: currentMinutes,
                executionStatus: 'MISSED_LATE',
                missedWindow: true,
                penaltyCutPoints: penalty,
              }
            : t
        );
        state.rewardPoints = Math.max(0, (state.rewardPoints || 0) - penalty);
        state.disciplinePenaltiesCount = (state.disciplinePenaltiesCount || 0) + 1;
        const evt = createSystemEvent('InterventionTriggered', taskId, { penaltyPoints: penalty }, state, 'GOVERNANCE_GUARD', undefined, clock);
        createdEvents.push(evt);
      } else if (command instanceof RecordTradingProtocolCommand) {
        state = applyLegacyTradingProtocolUpdate(state, command.payload.protocol);
        const gate = (state.externalExecutionGates || []).find(g => g.id === 'legacy-trading-execution-gate');
        if (gate) {
          createdEvents.push(createSystemEvent(
            'ExternalExecutionGateUpdated',
            gate.id,
            gate,
            state,
            'SYSTEM_KERNEL',
            undefined,
            clock
          ));
        }
      } else if (command instanceof RecordCompanyOfTheDayCommand) {
        state.companyOfTheDay = {
          ...state.companyOfTheDay,
          ...command.payload.company,
        };
      } else if (command instanceof RecordDailyReviewCommand) {
        state.dailyReview = {
          ...state.dailyReview,
          ...command.payload.review,
        };
        const reviewDate = state.dailyReview.date || state.activeDate || clock.toISOString().slice(0, 10);
        state = upsertDailyPerformanceRecord(state, reviewDate);
        state = reconcileWeeklyPerformance(state, reviewDate);
        state.weeklyAdaptationRecommendations = generateWeeklyAdaptationRecommendations(state);

        const daily = (state.dailyPerformanceRecords || []).find(r => r.localDate === reviewDate);
        const weekly = (state.weeklyPerformanceRecords || []).find(w => w.weekId === daily?.weekId);
        if (daily) {
          createdEvents.push(createSystemEvent('DailyPerformanceFinalized', daily.id, {
            localDate: daily.localDate,
            score: daily.overallDailyPerformanceScore,
            adjustedDayStrength: daily.adjustedDayStrength,
            confidence: daily.confidence,
          }, state, 'SYSTEM_KERNEL', undefined, clock));
        }
        if (weekly) {
          createdEvents.push(createSystemEvent('WeeklyPerformanceReconciled', weekly.id, {
            weekId: weekly.weekId,
            score: weekly.overallWeeklyPerformanceScore,
            bestDayDate: weekly.bestDayDate,
            confidence: weekly.confidence,
          }, state, 'SYSTEM_KERNEL', undefined, clock));
        }
      } else if (command instanceof RedeemRewardCommand) {
        const reward = state.rewards.find(r => r.id === command.payload.rewardId);
        if (!reward) {
          throw new Error(`Reward ${command.payload.rewardId} not found.`);
        }
        if (reward.redeemed) {
          throw new Error('Reward has already been redeemed.');
        }
        if (state.rewardPoints < reward.pointsRequired && !reward.unlocked) {
          throw new Error('Insufficient reward points.');
        }
        state.rewardPoints = Math.max(0, state.rewardPoints - reward.pointsRequired);
        state.rewards = state.rewards.map(r =>
          r.id === reward.id
            ? { ...r, unlocked: true, redeemed: true, redeemedAt: clock.toISOString() }
            : r
        );
        const evt = createSystemEvent('RewardRedeemed', reward.id, {
          rewardId: reward.id,
          pointsSpent: reward.pointsRequired,
        }, state, 'USER', undefined, clock);
        createdEvents.push(evt);
      } else if (command instanceof RecordIdentityStatusCommand) {
        state.identityStatus = {
          ...state.identityStatus,
          ...command.payload.identity,
        };
      } else if (command instanceof CreatePerformanceSessionCommand) {
        const session = performanceEngine.createSession(state, command.payload.activityInstanceId, {
          environmentType: command.payload.environmentType,
          protocolId: command.payload.protocolId,
          userId: (state as any).subjectId || 'standalone-subject'
        });
        state.performanceSessions = [...(state.performanceSessions || []), session];
        state.activePerformanceSessionId = session.id;
        state.activeView = 'PERFORMANCE';
        createdEvents.push(createSystemEvent('PerformanceSessionCreated', session.id, {
          sessionId: session.id,
          activityInstanceId: session.activityInstanceId,
          environmentType: session.environmentType,
          protocolId: session.protocolId,
        }, state, 'USER', undefined, clock));
      } else if (command instanceof PreparePerformanceSessionCommand) {
        const session = (state.performanceSessions || []).find(s => s.id === command.payload.sessionId);
        if (session) {
          const updated = performanceEngine.prepareSession(session);
          state.performanceSessions = state.performanceSessions!.map(s => s.id === updated.id ? updated : s);
          createdEvents.push(createSystemEvent('PerformancePreparationStarted', updated.id, { sessionId: updated.id }, state, 'USER', undefined, clock));
        }
      } else if (command instanceof ReadyPerformanceSessionCommand) {
        const session = (state.performanceSessions || []).find(s => s.id === command.payload.sessionId);
        if (session) {
          const updated = performanceEngine.readySession(session);
          state.performanceSessions = state.performanceSessions!.map(s => s.id === updated.id ? updated : s);
          createdEvents.push(createSystemEvent('PerformanceReady', updated.id, { sessionId: updated.id }, state, 'USER', undefined, clock));
        }
      } else if (command instanceof StartPerformanceSessionCommand) {
        const session = (state.performanceSessions || []).find(s => s.id === command.payload.sessionId);
        if (session) {
          const updated = performanceEngine.startSession(session);
          state.performanceSessions = state.performanceSessions!.map(s => s.id === updated.id ? updated : s);
          state.activePerformanceSessionId = updated.id;
          state.activeView = 'PERFORMANCE';
          createdEvents.push(createSystemEvent('PerformanceSessionStarted', updated.id, {
            sessionId: updated.id,
            startedAtUtc: updated.startedAtUtc,
          }, state, 'USER', undefined, clock));
        }
      } else if (command instanceof PausePerformanceSessionCommand) {
        const session = (state.performanceSessions || []).find(s => s.id === command.payload.sessionId);
        if (session) {
          const updated = performanceEngine.pauseSession(session);
          state.performanceSessions = state.performanceSessions!.map(s => s.id === updated.id ? updated : s);
          createdEvents.push(createSystemEvent('PerformanceSessionPaused', updated.id, { sessionId: updated.id }, state, 'USER', undefined, clock));
        }
      } else if (command instanceof ResumePerformanceSessionCommand) {
        const session = (state.performanceSessions || []).find(s => s.id === command.payload.sessionId);
        if (session) {
          const updated = performanceEngine.resumeSession(session);
          state.performanceSessions = state.performanceSessions!.map(s => s.id === updated.id ? updated : s);
          createdEvents.push(createSystemEvent('PerformanceSessionResumed', updated.id, { sessionId: updated.id }, state, 'USER', undefined, clock));
        }
      } else if (command instanceof AdvancePerformanceStepCommand) {
        const session = (state.performanceSessions || []).find(s => s.id === command.payload.sessionId);
        if (session) {
          const updated = performanceEngine.advanceStep(session, command.payload.stepIndex, {
            quantity: command.payload.quantity,
            branchSelectedId: command.payload.branchSelectedId,
            notes: command.payload.notes
          });
          state.performanceSessions = state.performanceSessions!.map(s => s.id === updated.id ? updated : s);
          createdEvents.push(createSystemEvent('PerformanceProgressRecorded', updated.id, {
            sessionId: updated.id,
            stepIndex: command.payload.stepIndex,
            quantity: command.payload.quantity,
            branchSelectedId: command.payload.branchSelectedId,
          }, state, 'USER', undefined, clock));
        }
      } else if (command instanceof AttachPerformanceArtifactCommand) {
        const session = (state.performanceSessions || []).find(s => s.id === command.payload.sessionId);
        if (session) {
          const updated = performanceEngine.attachArtifact(session, {
            artifactType: command.payload.artifactType,
            title: command.payload.title,
            uriOrRef: command.payload.uriOrRef,
            contentSnippet: command.payload.contentSnippet,
            provenance: command.payload.provenance
          });
          state.performanceSessions = state.performanceSessions!.map(s => s.id === updated.id ? updated : s);
          createdEvents.push(createSystemEvent('PerformanceArtifactAttached', updated.id, {
            sessionId: updated.id,
            title: command.payload.title,
            artifactType: command.payload.artifactType,
          }, state, 'USER', undefined, clock));
        }
      } else if (command instanceof RecordPerformanceEvidenceCommand) {
        const session = (state.performanceSessions || []).find(s => s.id === command.payload.sessionId);
        if (session) {
          const updated = performanceEngine.recordEvidence(session, {
            type: command.payload.type,
            source: (command.payload.source as any) || 'USER',
            trustLevel: command.payload.trustLevel,
            payload: command.payload.payload
          });
          state.performanceSessions = state.performanceSessions!.map(s => s.id === updated.id ? updated : s);
          createdEvents.push(createSystemEvent('PerformanceEvidenceRecorded', updated.id, {
            sessionId: updated.id,
            evidenceType: command.payload.type,
            trustLevel: command.payload.trustLevel,
            source: command.payload.source,
          }, state, command.payload.source === 'USER' ? 'USER' : 'SYSTEM_KERNEL', undefined, clock));
        }
      } else if (command instanceof RequestPerformanceExtensionCommand) {
        const session = (state.performanceSessions || []).find(s => s.id === command.payload.sessionId);
        if (session) {
          createdEvents.push(createSystemEvent('PerformanceExtensionRequested', session.id, {
            sessionId: session.id,
            requestedMinutes: command.payload.requestedMinutes,
            reason: command.payload.reason,
          }, state, 'USER', undefined, clock));
          const result = performanceEngine.requestExtension(state, session, command.payload.requestedMinutes, command.payload.reason);
          state = result.updatedState;
          createdEvents.push(createSystemEvent(result.approved ? 'PerformanceExtensionApproved' : 'PerformanceExtensionDenied', session.id, {
            sessionId: session.id,
            requestedMinutes: command.payload.requestedMinutes,
            reason: result.reasonText,
          }, state, 'GOVERNANCE_GUARD', undefined, clock));
        }
      } else if (command instanceof ClosePerformanceSessionCommand) {
        const session = (state.performanceSessions || []).find(s => s.id === command.payload.sessionId);
        if (session) {
          const { updatedSession, outcomeResult } = performanceEngine.closeSession(session, command.payload.outcome, {
            qualityAssessment: command.payload.qualityAssessment,
            reason: command.payload.reason
          });
          state.performanceSessions = state.performanceSessions!.map(s => s.id === updatedSession.id ? updatedSession : s);
          state.activePerformanceSessionId = null;

          // HEE-002: Transition parent ActivityInstance lifecycle authoritatively
          if (outcomeResult.outcome === 'COMPLETED') {
            state.tasks = state.tasks.map(t =>
              t.id === updatedSession.activityInstanceId
                ? { ...t, completed: true, completedAtMinutes: currentMinutes, executionStatus: 'COMPLETED' }
                : t
            );

            // Award reward point once idempotently
            const parentTask = state.tasks.find(t => t.id === updatedSession.activityInstanceId);
            const rewardKey = parentTask?.anchorId || updatedSession.activityInstanceId;
            if (!state.pointsAwardedTasks.includes(rewardKey)) {
              const points = 10;
              state.rewardPoints = (state.rewardPoints || 0) + points;
              state.pointsAwardedTasks = [...state.pointsAwardedTasks, rewardKey];
            }
          } else if (outcomeResult.outcome === 'PARTIAL') {
            state.tasks = state.tasks.map(t =>
              t.id === updatedSession.activityInstanceId
                ? { ...t, completed: false, executionStatus: 'PARTIAL' }
                : t
            );
          } else if (outcomeResult.outcome === 'BLOCKED') {
            state.tasks = state.tasks.map(t =>
              t.id === updatedSession.activityInstanceId
                ? { ...t, completed: false, executionStatus: 'BLOCKED' }
                : t
            );
          }

          createdEvents.push(createSystemEvent('PerformanceOutcomeEvaluated', updatedSession.id, {
            sessionId: updatedSession.id,
            outcome: outcomeResult.outcome,
            completionPercentage: outcomeResult.completionPercentage,
            activeDurationSeconds: outcomeResult.activeDurationSeconds,
          }, state, 'SYSTEM_KERNEL', undefined, clock));
          createdEvents.push(createSystemEvent('PerformanceSessionClosed', updatedSession.id, {
            sessionId: updatedSession.id,
            status: updatedSession.status,
          }, state, 'SYSTEM_KERNEL', undefined, clock));

          // Return to NOW view
          state.activeView = 'NOW';
        }
      } else if (command instanceof CancelPerformanceSessionCommand) {
        const session = (state.performanceSessions || []).find(s => s.id === command.payload.sessionId);
        if (session) {
          const updated = performanceEngine.cancelSession(session, command.payload.reason);
          state.performanceSessions = state.performanceSessions!.map(s => s.id === updated.id ? updated : s);
          state.activePerformanceSessionId = null;
          state.activeView = 'NOW';
          createdEvents.push(createSystemEvent('PerformanceSessionClosed', updated.id, {
            sessionId: updated.id,
            status: 'CANCELLED',
            reason: command.payload.reason,
          }, state, 'USER', undefined, clock));
        }
      }

    } catch (err: any) {
      domainSuccess = false;
      failureReason = err.message || 'Unknown domain execution error';
    }

    if (!domainSuccess) {
      return {
        success: false,
        state,
        events: [],
        error: failureReason,
      };
    }

    // 5. EVENT CREATION & PERSISTENCE STAGE
    if (createdEvents.length > 0) {
      state.events = [...createdEvents, ...(state.events || [])].slice(0, 200);
      for (const event of createdEvents) {
        const behavioralSignal = projectExecutionBehavioralSignal(event, state);
        if (behavioralSignal) state = recordBehavioralSignal(state, behavioralSignal);
      }
      try {
        await defaultDurableEventStore.appendBatch(createdEvents);
        await defaultEventDispatcher.dispatchBatch(createdEvents);
      } catch (err) {
        console.warn('[TransactionPipeline Event Store Warning]', err);
      }
    }

    // 6. REPOSITORY PERSISTENCE STAGE
    await repository.saveState(state);

    // 7. RESULTING STATE
    return {
      success: true,
      state,
      events: createdEvents,
      message: `Executed command ${command.type}`,
    };
  }
}

export const defaultTransactionPipeline = new TransactionPipeline(defaultExecutionRepository);
