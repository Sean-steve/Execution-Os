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
  RedeemRewardCommand
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
import { domainExecutionPolicies } from '../domainPolicies';

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

    const commitAllocationResult = (result: ReturnType<typeof calculateDynamicAllocations>) => {
      state.dynamicAllocations = result.allocations;
      state.tasks = result.recalculatedTasks;
      state.lastReallocationReason = result.reallocationReason;

      if (result.scheduleProposal) {
        state.pendingScheduleProposals = [
          ...(state.pendingScheduleProposals || []).filter(p => p.status === 'PROPOSED'),
          result.scheduleProposal,
        ];
        createdEvents.push(createSystemEvent(
          'ScheduleChangeProposed',
          result.scheduleProposal.id,
          {
            planId: result.scheduleProposal.planId,
            planRevision: result.scheduleProposal.planRevision,
            reason: result.scheduleProposal.reason,
            changes: result.scheduleProposal.changes,
          },
          state,
          'SYSTEM_KERNEL',
          undefined,
          clock
        ));
      }
    };

    const proposeScheduleMutation = (
      task: RoutineTask,
      proposedStartMinutes: number,
      proposedEndMinutes: number,
      reason: string,
      compressed: boolean = false,
      fallbackLevel?: number
    ) => {
      const proposal = {
        id: `sched-proposal-${Date.now()}-${task.id}`,
        source: 'EXECUTION_OS' as const,
        authority: 'HOS' as const,
        planId: state.scheduleAuthority?.planId,
        planRevision: state.scheduleAuthority?.planRevision,
        createdAtUtc: clock.toISOString(),
        reason,
        status: 'PROPOSED' as const,
        changes: [{
          activityId: task.id,
          fromStartMinutes: task.allocatedStartMinutes ?? task.startMinutes,
          fromEndMinutes: task.allocatedEndMinutes ?? task.endMinutes,
          proposedStartMinutes,
          proposedEndMinutes,
          compressed,
          fallbackLevel,
        }],
      };
      state.pendingScheduleProposals = [
        ...(state.pendingScheduleProposals || []).filter(p => p.status === 'PROPOSED'),
        proposal,
      ];
      createdEvents.push(createSystemEvent(
        'ScheduleChangeProposed',
        proposal.id,
        { planId: proposal.planId, planRevision: proposal.planRevision, reason, changes: proposal.changes },
        state,
        'USER',
        undefined,
        clock
      ));
    };

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
      if (command instanceof PlanTomorrowCommand) {
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
                  allocatedStartMinutes: currentMinutes,
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

        // Domain-specific completion gates are evaluated through registered adapters.
        for (const result of domainExecutionPolicies.evaluateCompletion(state, taskId)) {
          if (result.blocked) {
            throw new Error((result.errorCode || 'DOMAIN_POLICY_DENIED') + ': ' + result.reasons.join('; '));
          }
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

          // Run allocations to adjust upcoming schedule cursor
          const allocs = calculateDynamicAllocations(state);
          commitAllocationResult(allocs);

          const routineEval = evaluateRoutineState(state);
          state.routineState = routineEval.routineState;
          if (routineEval.reason) state.routineChangeReason = routineEval.reason;

          const evt = createSystemEvent('ActivityCompleted', taskId, { completedAtMinutes: completionTime, executionStatus: finalStatus }, state, 'USER', undefined, clock);
          createdEvents.push(evt);
        }
      } else if (command instanceof AdjustActivityCommand) {
        const { taskId, startMinutes, endMinutes } = command.payload;
        const task = state.tasks.find(t => t.id === taskId);
        if (task && state.scheduleAuthority?.mode === 'HOS_DELEGATED') {
          proposeScheduleMutation(
            task,
            startMinutes ?? task.allocatedStartMinutes ?? task.startMinutes,
            endMinutes ?? task.allocatedEndMinutes ?? task.endMinutes,
            'User requested schedule adjustment; HOS approval required.'
          );
        } else {
          state.tasks = state.tasks.map(t => {
            if (t.id === taskId) {
              return {
                ...t,
                startMinutes: startMinutes !== undefined ? startMinutes : t.startMinutes,
                endMinutes: endMinutes !== undefined ? endMinutes : t.endMinutes,
                allocatedStartMinutes: startMinutes !== undefined ? startMinutes : t.allocatedStartMinutes,
                allocatedEndMinutes: endMinutes !== undefined ? endMinutes : t.allocatedEndMinutes,
              };
            }
            return t;
          });
          const allocs = calculateDynamicAllocations(state);
          commitAllocationResult(allocs);
          const evt = createSystemEvent('AllocationChanged', taskId, command.payload, state, 'USER', undefined, clock);
          createdEvents.push(evt);
        }
      } else if (command instanceof AdvanceActivityCommand) {
        const { taskId, minutes, reason } = command.payload;
        const task = state.tasks.find(t => t.id === taskId);
        if (task) {
          const start = task.allocatedStartMinutes ?? task.startMinutes;
          const end = task.allocatedEndMinutes ?? task.endMinutes;
          if (state.scheduleAuthority?.mode === 'HOS_DELEGATED') {
            proposeScheduleMutation(task, Math.max(0, start - minutes), Math.max(1, end - minutes), reason);
          } else {
            const oldState = { start: task.startMinutes, end: task.endMinutes };
            state.tasks = state.tasks.map(t =>
              t.id === taskId
                ? { ...t, startMinutes: Math.max(0, t.startMinutes - minutes), endMinutes: Math.max(10, t.endMinutes - minutes) }
                : t
            );
            const overrideRecord: UserOverrideRecord = {
              id: `ovr-${Date.now()}`,
              timestamp: clock.toISOString(),
              activityId: taskId,
              overrideType: 'ADVANCE',
              reason,
              previousState: oldState,
              newState: { minutesAdvanced: minutes },
            };
            state.userOverrides = [overrideRecord, ...(state.userOverrides || [])];
            createdEvents.push(createSystemEvent('OverrideCreated', taskId, overrideRecord, state, 'USER', undefined, clock));
          }
        }
      } else if (command instanceof DeferActivityCommand) {
        const { taskId, minutes, reason } = command.payload;
        const task = state.tasks.find(t => t.id === taskId);
        if (task) {
          const start = task.allocatedStartMinutes ?? task.startMinutes;
          const end = task.allocatedEndMinutes ?? task.endMinutes;
          if (state.scheduleAuthority?.mode === 'HOS_DELEGATED') {
            proposeScheduleMutation(task, Math.min(1439, start + minutes), Math.min(1440, end + minutes), reason);
          } else {
            const oldState = { start: task.startMinutes, end: task.endMinutes };
            state.tasks = state.tasks.map(t =>
              t.id === taskId
                ? { ...t, startMinutes: Math.min(1430, t.startMinutes + minutes), endMinutes: Math.min(1440, t.endMinutes + minutes) }
                : t
            );
            const overrideRecord: UserOverrideRecord = {
              id: `ovr-${Date.now()}`,
              timestamp: clock.toISOString(),
              activityId: taskId,
              overrideType: 'DEFER',
              reason,
              previousState: oldState,
              newState: { minutesDeferred: minutes },
            };
            state.userOverrides = [overrideRecord, ...(state.userOverrides || [])];
            createdEvents.push(createSystemEvent('OverrideCreated', taskId, overrideRecord, state, 'USER', undefined, clock));
          }
        }
      } else if (command instanceof CompressActivityCommand) {
        const { taskId, targetDurationMinutes, reason, fallbackTierLevel } = command.payload;
        const targetLevel = fallbackTierLevel !== undefined ? fallbackTierLevel : 1;
        const task = state.tasks.find(t => t.id === taskId);
        if (task && state.scheduleAuthority?.mode === 'HOS_DELEGATED') {
          const start = task.allocatedStartMinutes ?? task.startMinutes;
          proposeScheduleMutation(task, start, start + targetDurationMinutes, reason, true, targetLevel);
        } else {
          state.tasks = state.tasks.map(t => {
            if (t.id === taskId) {
              const start = t.allocatedStartMinutes || t.startMinutes;
              return {
                ...t,
                endMinutes: start + targetDurationMinutes,
                allocatedEndMinutes: start + targetDurationMinutes,
                fallbackLevel: targetLevel,
                executionStatus: 'COMPRESSED',
              };
            }
            return t;
          });
          const allocs = calculateDynamicAllocations(state);
          commitAllocationResult(allocs);
          state.tasks = state.tasks.map(t =>
            t.id === taskId
              ? { ...t, fallbackLevel: targetLevel, executionStatus: 'COMPRESSED' }
              : t
          );
          createdEvents.push(createSystemEvent('FallbackTriggered', taskId, { targetDurationMinutes, reason }, state, 'USER', undefined, clock));
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
        // Run full HEE evaluation pipeline
        const devScan = scanAndResolveDeviations(state);
        state = devScan.updatedState;

        const allocs = calculateDynamicAllocations(state);
        commitAllocationResult(allocs);

        const routineEval = evaluateRoutineState(state);
        state.routineState = routineEval.routineState;
        if (routineEval.reason) state.routineChangeReason = routineEval.reason;

        const nextDecision = getAutonomousNextDecision(state);
        if (nextDecision.decisionReason) {
          state.lastDecisionReason = nextDecision.decisionReason;
        }

        const evt = createSystemEvent('AllocationChanged', 'daySchedule', { currentMinutes, reason: command.payload.reason || 'Recalculate day triggered' }, state, 'SYSTEM_KERNEL', undefined, clock);
        createdEvents.push(evt);
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
        commitAllocationResult(allocs);
        const evt = createSystemEvent('RoutineChanged', 'mode', { mode: command.payload.mode }, state, 'USER', undefined, clock);
        createdEvents.push(evt);
      } else if (command instanceof SetDayTypeCommand) {
        state.dayType = command.payload.dayType;
        const allocs = calculateDynamicAllocations(state);
        commitAllocationResult(allocs);
        const evt = createSystemEvent('RoutineChanged', 'dayType', { dayType: command.payload.dayType }, state, 'USER', undefined, clock);
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
        state.tradingProtocol = {
          ...state.tradingProtocol,
          ...command.payload.protocol,
        };
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
          userId: 'user_primary'
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
