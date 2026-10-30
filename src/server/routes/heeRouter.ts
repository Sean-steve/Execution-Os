import { Router, Request, Response, NextFunction } from 'express';
import { IExecutionRepository, defaultExecutionRepository } from '../../repositories';
import { IClock, getClockForState } from '../../clock';
import {
  PlanTomorrowCommand,
  ActivateDayCommand,
  StartActivityCommand,
  PauseActivityCommand,
  ResumeActivityCommand,
  CompleteActivityCommand,
  AdjustActivityCommand,
  OverrideActivityCommand,
  RecalculateDayCommand,
  ApproveDecisionCommand,
  RejectDecisionCommand,
  SetSystemModeCommand,
  SetDayTypeCommand,
  SetSimulatedTimeCommand,
  ApplyAdaptationProposalCommand,
  RollbackAdaptationProposalCommand,
  RetainAdaptationProposalCommand,
  RejectAdaptationProposalCommand,
  EvaluateAdaptationMeasurementCommand,
  AcceptDisciplinePenaltyCommand,
  PauseAutonomyCommand,
  ResumeAutonomyCommand,
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
  CancelPerformanceSessionCommand
} from '../../commands/commands';
import { processAuthoritativeCommand, CommandExecutionOptions } from '../commandPipeline';
import { GovernanceEngine } from '../governance';
import { evaluateRoutineState } from '../../services/routineEngine';
import { calculateDynamicAllocations, PROTECTED_FAMILY_START, PROTECTED_FAMILY_END } from '../../services/allocationEngine';
import { scanAndResolveDeviations } from '../../services/deviationEngine';
import { getAutonomousNextDecision } from '../../services/decisionEngine';
import { checkTaskDependencies } from '../../services/dependencyEngine';
import { calculate7Pillars, checkNeverMissTwice } from '../../services/storageService';
import { evaluateTomorrowFeasibility } from '../../services/tomorrowPlanningEngine';
import { defaultDurableEventStore } from '../../services/durableEventStore';
import { defaultExecutionAuditService } from '../../services/executionAuditService';
import { defaultDeadLetterQueue } from '../../services/deadLetterQueue';
import { defaultEventDispatcher } from '../../services/eventDispatcher';
import { defaultEventChainService } from '../../services/eventChains';
import { defaultBackgroundWorker, BackgroundWorker } from '../../services/backgroundWorker';
import { reconcileLifecycleState } from '../../services/reconciliationEngine';
import { ExecutionApplicationService } from '../../services/executionApplicationService';
import { defaultIdempotencyStore } from '../idempotency';
import { defaultRateLimiter } from '../rateLimiter';
import { SchemaValidator } from '../validation';
import { SecurityEngine } from '../security';
import { requirePermission } from '../auth';
import { ConflictResolutionRecord, DeviceProfile, SyncQueueItem, LongitudinalWindow } from '../../types';
import { scanLongitudinalAdaptations, generateLongitudinalExecutionHistory } from '../../services/adaptationEngine';
import {
  ValidationError,
  ResourceNotFoundError,
  GovernanceDeniedError,
  TradingGateClosedError,
  DependencyBlockedError
} from '../errors';

export function createHeeRouter(repository: IExecutionRepository = defaultExecutionRepository, clock?: IClock): Router {
  const router = Router();
  const options: CommandExecutionOptions = { repository, clock };

  // =========================================================================
  // 1. STATE & EXECUTION QUERIES (GET) & AUTH TOKEN GENERATION
  // =========================================================================

  // Rate Limiting: 120 req/min for general queries, 30 req/min for mutations
  const mutationLimiter = defaultRateLimiter.createMiddleware({
    windowMs: 60000,
    maxRequests: 60,
  });

  const sensitiveLimiter = defaultRateLimiter.createMiddleware({
    windowMs: 60000,
    maxRequests: 20,
  });

  /**
   * POST /api/v1/hee/auth/token
   * Generates a signed cryptographic session token for authenticated multi-tenant security
   */
  router.post('/auth/token', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId = 'user-owner', role = 'OWNER', tenantId = 'tenant-default', durationSeconds = 86400 } = req.body || {};
      const token = SecurityEngine.generateSessionToken(userId, role, tenantId, durationSeconds);
      const claims = SecurityEngine.verifySessionToken(token);

      res.status(200).json({
        success: true,
        token,
        claims,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/v1/hee/auth/sign-override
   * Generates a tamper-proof HMAC-SHA256 signature for consequential command overrides
   */
  router.post('/auth/sign-override', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId, overrideType, reason, targetTaskId, targetMode, timestamp } = req.body || {};
      if (!userId || !overrideType || !reason) {
        throw new ValidationError('userId, overrideType, and reason are required to sign an override.');
      }
      const signature = SecurityEngine.signOverridePayload({
        userId,
        overrideType,
        reason,
        targetTaskId,
        targetMode,
        timestamp: timestamp || new Date().toISOString(),
      });

      res.status(200).json({
        success: true,
        signature,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/v1/hee/execution/now
   * Returns authoritative real-time execution snapshot, active task, and next decision
   */
  router.get('/execution/now', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const state = await repository.loadState();
      const stateClock = clock || getClockForState(state);
      const currentTimeMinutes = stateClock.getCurrentTimeMinutes();
      const currentTimeStr = stateClock.getTimeString();

      const routineEval = evaluateRoutineState(state);
      const nextDecision = getAutonomousNextDecision(state);
      const currentTask = state.tasks.find(t =>
        !t.completed &&
        currentTimeMinutes >= (t.allocatedStartMinutes ?? t.startMinutes) &&
        currentTimeMinutes < (t.allocatedEndMinutes ?? t.endMinutes)
      ) || nextDecision.currentTask;

      const activeAllocation = state.dynamicAllocations.find(a =>
        currentTimeMinutes >= a.allocatedStartMinutes && currentTimeMinutes < a.allocatedEndMinutes
      );

      const isTradingBlocked = checkTaskDependencies(state, 'task-trading-execution').isBlocked;

      res.status(200).json({
        success: true,
        data: {
          currentTime: currentTimeStr,
          currentTimeMinutes,
          routineState: state.routineState,
          isCompressed: routineEval.isCompressed,
          currentMode: state.currentMode,
          dayType: state.dayType,
          currentTask,
          activeAllocation,
          nextDecision,
          isTradingBlocked,
          autonomyLevel: state.autonomyLevel,
          rewardPoints: state.rewardPoints,
          version: (state as any).version || 1,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/v1/hee/execution/today
   * Returns comprehensive daily execution ledger, allocations, deviations & pillars
   */
  router.get('/execution/today', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const state = await repository.loadState();
      const sevenPillars = calculate7Pillars(state);
      const neverMissTwiceAlert = checkNeverMissTwice(state);

      res.status(200).json({
        success: true,
        data: {
          date: state.simulatedTime,
          routineState: state.routineState,
          currentMode: state.currentMode,
          dayType: state.dayType,
          autonomyLevel: state.autonomyLevel,
          tasks: state.tasks,
          dynamicAllocations: state.dynamicAllocations,
          deviations: state.deviations,
          interventions: state.interventions,
          tomorrowPlan: state.tomorrowPlan,
          activeHumanDecision: state.activeHumanDecision,
          sevenPillars,
          neverMissTwiceAlert,
          rewardPoints: state.rewardPoints,
          disciplinePenaltiesCount: state.disciplinePenaltiesCount || 0,
          version: (state as any).version || 1,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/v1/hee/state
   * Full root state dump with cryptographic state checksum (EOS-007)
   */
  router.get('/state', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const state = await repository.loadState();
      const checksum = SecurityEngine.computeStateChecksum(state);
      res.status(200).json({
        success: true,
        data: state,
        version: (state as any).version || 1,
        checksum,
        serverTime: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  });

  // =========================================================================
  // 2. NIGHT-BEFORE PLANNING & DAY ACTIVATION
  // =========================================================================

  /**
   * POST /api/v1/hee/plan/tomorrow
   * Authoritatively updates tomorrow's execution blueprint
   */
  router.post('/plan/tomorrow', async (req: Request, res: Response, next: NextFunction) => {
    const plan = req.body?.plan;
    if (!plan || typeof plan !== 'object' || Object.keys(plan).length === 0) {
      return next(new ValidationError('Missing or empty "plan" object in request body'));
    }

    await processAuthoritativeCommand(
      req,
      res,
      next,
      () => new PlanTomorrowCommand({ plan }),
      options
    );
  });

  /**
   * POST /api/v1/hee/plan/tomorrow/feasibility
   * Deterministically previews feasibility, predicted mode, and conflicts for a proposed plan
   */
  router.post('/plan/tomorrow/feasibility', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const state = await repository.loadState();
      const plan = req.body?.plan || state.tomorrowPlan;
      const feasibility = evaluateTomorrowFeasibility(plan, state);

      res.status(200).json({
        success: true,
        data: feasibility,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/v1/hee/day/activate
   */
  router.post('/day/activate', async (req: Request, res: Response, next: NextFunction) => {
    const { mode, dayType, date } = req.body || {};
    await processAuthoritativeCommand(
      req,
      res,
      next,
      () => new ActivateDayCommand({ mode, dayType, date }),
      options
    );
  });

  /**
   * POST /api/v1/hee/day/late-wake-recovery
   * Triggers autonomous late wake recovery workflow
   */
  router.post('/day/late-wake-recovery', async (req: Request, res: Response, next: NextFunction) => {
    const { actualWakeMinutes, actualWakeTime, reason } = req.body || {};
    await processAuthoritativeCommand(
      req,
      res,
      next,
      () => new LateWakeRecoveryCommand({ actualWakeMinutes, actualWakeTime, reason }),
      options
    );
  });

  // =========================================================================
  // 3. ACTIVITY MUTATIONS (START, PAUSE, RESUME, COMPLETE, ADJUST, OVERRIDE)
  // =========================================================================

  /**
   * POST /api/v1/hee/activities/:id/start
   */
  router.post('/activities/:id/start', async (req: Request, res: Response, next: NextFunction) => {
    const taskId = req.params.id;
    if (!taskId) return next(new ValidationError('Activity ID is required'));

    await processAuthoritativeCommand(
      req,
      res,
      next,
      (state) => {
        const gov = GovernanceEngine.evaluateActivityStart(state, taskId);
        if (!gov.allowed && gov.error) throw gov.error;
        return new StartActivityCommand({ taskId });
      },
      options
    );
  });

  /**
   * POST /api/v1/hee/activities/:id/pause
   */
  router.post('/activities/:id/pause', async (req: Request, res: Response, next: NextFunction) => {
    const taskId = req.params.id;
    const reason = req.body?.reason || 'User paused activity';
    if (!taskId) return next(new ValidationError('Activity ID is required'));

    await processAuthoritativeCommand(
      req,
      res,
      next,
      () => new PauseActivityCommand({ taskId, reason }),
      options
    );
  });

  /**
   * POST /api/v1/hee/activities/:id/resume
   */
  router.post('/activities/:id/resume', async (req: Request, res: Response, next: NextFunction) => {
    const taskId = req.params.id;
    if (!taskId) return next(new ValidationError('Activity ID is required'));

    await processAuthoritativeCommand(
      req,
      res,
      next,
      () => new ResumeActivityCommand({ taskId }),
      options
    );
  });

  /**
   * POST /api/v1/hee/activities/:id/complete
   */
  router.post('/activities/:id/complete', async (req: Request, res: Response, next: NextFunction) => {
    const taskId = req.params.id;
    const { executionStatus, missedWindow, penaltyCutPoints, completedAtMinutes } = req.body || {};
    if (!taskId) return next(new ValidationError('Activity ID is required'));

    await processAuthoritativeCommand(
      req,
      res,
      next,
      () => new CompleteActivityCommand({ taskId, executionStatus, missedWindow, penaltyCutPoints, completedAtMinutes }),
      options
    );
  });

  /**
   * POST /api/v1/hee/activities/:id/adjust
   */
  router.post('/activities/:id/adjust', async (req: Request, res: Response, next: NextFunction) => {
    const taskId = req.params.id;
    const { startMinutes, endMinutes, reason, isEmergencyOverride } = req.body || {};
    if (!taskId) return next(new ValidationError('Activity ID is required'));

    await processAuthoritativeCommand(
      req,
      res,
      next,
      (state) => {
        if (startMinutes !== undefined && endMinutes !== undefined) {
          const gov = GovernanceEngine.evaluateActivitySchedule(state, taskId, startMinutes, endMinutes, isEmergencyOverride);
          if (!gov.allowed && gov.error) throw gov.error;
        }
        return new AdjustActivityCommand({ taskId, startMinutes, endMinutes, reason });
      },
      options
    );
  });

  /**
   * POST /api/v1/hee/activities/:id/override
   */
  router.post('/activities/:id/override', sensitiveLimiter, async (req: Request, res: Response, next: NextFunction) => {
    const taskId = req.params.id;
    const { overrideType, reason, modifications, signature, timestamp } = req.body || {};
    if (!taskId || !overrideType || !reason || typeof reason !== 'string' || reason.trim() === '') {
      return next(new ValidationError('Missing required fields: taskId, overrideType, and valid non-empty reason are required.'));
    }

    await processAuthoritativeCommand(
      req,
      res,
      next,
      (state, user) => {
        const gov = GovernanceEngine.evaluateOverride(state, {
          userId: user.userId,
          overrideType,
          reason,
          targetTaskId: taskId,
          timestamp,
          signature,
        });
        if (!gov.allowed && gov.error) throw gov.error;
        return new OverrideActivityCommand({ taskId, overrideType, reason, modifications, signature });
      },
      options
    );
  });

  // =========================================================================
  // 4. ALLOCATION RECALCULATION
  // =========================================================================

  /**
   * POST /api/v1/hee/allocations/recalculate
   */
  router.post('/allocations/recalculate', async (req: Request, res: Response, next: NextFunction) => {
    const { force, reason } = req.body || {};
    await processAuthoritativeCommand(
      req,
      res,
      next,
      () => new RecalculateDayCommand({ force: !!force, reason }),
      options
    );
  });

  // =========================================================================
  // 5. DECISION INTELLIGENCE & HUMAN APPROVALS
  // =========================================================================

  /**
   * GET /api/v1/hee/decisions/pending
   */
  router.get('/decisions/pending', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const state = await repository.loadState();
      const nextDecision = getAutonomousNextDecision(state);
      const pending = state.activeHumanDecision
        ? [state.activeHumanDecision]
        : [];

      res.status(200).json({
        success: true,
        data: {
          pendingDecisions: pending,
          autonomousDecision: nextDecision,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/v1/hee/decisions/:id/approve
   */
  router.post('/decisions/:id/approve', async (req: Request, res: Response, next: NextFunction) => {
    const decisionId = req.params.id;
    const optionId = req.body?.optionId;
    if (!decisionId || !optionId) {
      return next(new ValidationError('decisionId and optionId are required'));
    }

    await processAuthoritativeCommand(
      req,
      res,
      next,
      (state) => {
        const gov = GovernanceEngine.evaluateDecisionApproval(state, decisionId, optionId);
        if (!gov.allowed && gov.error) throw gov.error;
        return new ApproveDecisionCommand({ decisionId, optionId });
      },
      options
    );
  });

  /**
   * POST /api/v1/hee/decisions/:id/reject
   */
  router.post('/decisions/:id/reject', async (req: Request, res: Response, next: NextFunction) => {
    const decisionId = req.params.id;
    const reason = req.body?.reason || 'User rejected decision recommendation';
    if (!decisionId) {
      return next(new ValidationError('decisionId is required'));
    }

    await processAuthoritativeCommand(
      req,
      res,
      next,
      () => new RejectDecisionCommand({ decisionId, reason }),
      options
    );
  });

  // =========================================================================
  // 6. GOVERNANCE POLICIES & PROTECTED COMMITMENTS
  // =========================================================================

  /**
   * GET /api/v1/hee/governance/policies
   */
  router.get('/governance/policies', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const state = await repository.loadState();
      res.status(200).json({
        success: true,
        data: {
          autonomyLevel: state.autonomyLevel,
          currentMode: state.currentMode,
          neverMissTwiceAlert: checkNeverMissTwice(state),
          overridesCount: state.userOverrides.length,
          overrides: state.userOverrides,
          tradingRules: {
            requirePreMarketAnalysis: true,
            requireSetupVerification: true,
            maxOpenRiskPercent: 1.0,
          },
        },
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * PATCH /api/v1/hee/governance/policies
   */
  router.patch('/governance/policies', async (req: Request, res: Response, next: NextFunction) => {
    const { autonomyLevel, mode } = req.body || {};

    if (autonomyLevel === 5 || autonomyLevel === 'MANUAL') {
      await processAuthoritativeCommand(
        req,
        res,
        next,
        () => new PauseAutonomyCommand({ reason: 'Governance policy updated to MANUAL' }),
        options
      );
    } else if (typeof autonomyLevel === 'number') {
      await processAuthoritativeCommand(
        req,
        res,
        next,
        () => new ResumeAutonomyCommand({ targetLevel: autonomyLevel as any }),
        options
      );
    } else if (mode) {
      await processAuthoritativeCommand(
        req,
        res,
        next,
        () => new SetSystemModeCommand({ mode }),
        options
      );
    } else {
      res.status(200).json({ success: true, message: 'No policy changes provided' });
    }
  });

  /**
   * GET /api/v1/hee/governance/protected-commitments
   */
  router.get('/governance/protected-commitments', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(200).json({
        success: true,
        data: {
          commitments: [
            {
              id: 'commitment-family-block',
              name: 'Protected Family Life Window',
              startMinutes: PROTECTED_FAMILY_START,
              endMinutes: PROTECTED_FAMILY_END,
              startTime: '16:00',
              endTime: '19:30',
              strict: true,
              description: 'Non-negotiable family block — non-family activities are prohibited unless explicit emergency override granted.',
            },
            {
              id: 'commitment-sleep-sanctuary',
              name: 'Night Sleep Sanctuary',
              startMinutes: 1350,
              endMinutes: 330,
              startTime: '22:30',
              endTime: '05:30',
              strict: true,
              description: 'Mandatory rest window for neuro-biological recovery.',
            },
          ],
        },
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * PATCH /api/v1/hee/governance/protected-commitments
   */
  router.patch('/governance/protected-commitments', async (req: Request, res: Response, next: NextFunction) => {
    const { commitments } = req.body || {};
    res.status(200).json({
      success: true,
      message: 'Protected commitments updated successfully',
      data: { updatedCount: (commitments || []).length },
    });
  });

  // =========================================================================
  // 7. SIMULATION RUN ENGINE
  // =========================================================================

  /**
   * POST /api/v1/hee/simulation/run
   * Runs authoritative HEE evaluation and allocation simulation for target scenario
   */
  router.post('/simulation/run', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { simulatedTime, mode, dayType, dryRun = true } = req.body || {};
      if (!simulatedTime) {
        return next(new ValidationError('simulatedTime (e.g. "06:35") is required'));
      }

      let testState = await repository.loadState();
      testState = JSON.parse(JSON.stringify(testState));
      testState.isSimulatedTime = true;
      testState.simulatedTime = simulatedTime;
      if (mode) testState.currentMode = mode;
      if (dayType) testState.dayType = dayType;

      // 1. Routine engine
      const routineEval = evaluateRoutineState(testState);
      testState.routineState = routineEval.routineState;
      testState.routineChangeReason = routineEval.reason;

      // 2. Deviation scan
      const deviationScan = scanAndResolveDeviations(testState);
      testState = deviationScan.updatedState;

      // 3. Allocations
      const allocationResult = calculateDynamicAllocations(testState);
      testState.dynamicAllocations = allocationResult.allocations;
      testState.tasks = allocationResult.recalculatedTasks;

      // 4. Decision
      const nextDecision = getAutonomousNextDecision(testState);

      if (!dryRun) {
        await repository.saveState(testState);
      }

      res.status(200).json({
        success: true,
        dryRun,
        data: {
          simulatedTime,
          routineState: testState.routineState,
          isCompressed: routineEval.isCompressed,
          deviationsCount: deviationScan.detectedDeviations.length,
          allocationsCount: allocationResult.allocations.length,
          isFeasible: allocationResult.isFeasible,
          nextDecision,
          projectedState: testState,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  // =========================================================================
  // 8. SYSTEM MODE, DAY TYPE, SIMULATED TIME, ADAPTATION & PENALTIES
  // =========================================================================

  router.post('/mode', async (req: Request, res: Response, next: NextFunction) => {
    const { mode } = req.body || {};
    if (!mode) return next(new ValidationError('mode is required'));
    await processAuthoritativeCommand(req, res, next, () => new SetSystemModeCommand({ mode }), options);
  });

  router.post('/day-type', async (req: Request, res: Response, next: NextFunction) => {
    const { dayType } = req.body || {};
    if (!dayType) return next(new ValidationError('dayType is required'));
    await processAuthoritativeCommand(req, res, next, () => new SetDayTypeCommand({ dayType }), options);
  });

  router.post('/time', async (req: Request, res: Response, next: NextFunction) => {
    const { isSimulatedTime, simulatedTime } = req.body || {};
    if (simulatedTime === undefined) return next(new ValidationError('simulatedTime is required'));
    await processAuthoritativeCommand(req, res, next, () => new SetSimulatedTimeCommand({ isSimulatedTime: !!isSimulatedTime, simulatedTime }), options);
  });

  // =========================================================================
  // 8. LONGITUDINAL EXECUTION INTELLIGENCE & ADAPTATION LIFECYCLE (EOS-012, EOS-006)
  // =========================================================================

  /**
   * GET /api/v1/hee/adaptations/intelligence
   * Returns longitudinal execution intelligence across 7d, 30d, 60d, 90d windows
   */
  router.get('/adaptations/intelligence', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const window = (req.query.window as LongitudinalWindow) || '30d';
      const state = await repository.loadState();
      const scanResult = scanLongitudinalAdaptations(state, window);

      res.status(200).json({
        success: true,
        data: scanResult.summary,
        patterns: scanResult.patterns,
        proposals: scanResult.proposals,
        anomalyDaysFilteredCount: scanResult.anomalyDaysFilteredCount,
        serverTime: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/v1/hee/adaptations/scan
   * Performs longitudinal scan and updates state with detected patterns and proposals
   */
  router.post('/adaptations/scan', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const window = (req.body?.window as LongitudinalWindow) || '30d';
      let state = await repository.loadState();
      state.longitudinalWindow = window;

      const scanResult = scanLongitudinalAdaptations(state, window);
      state.adaptationPatterns = scanResult.patterns;
      state.adaptationProposals = scanResult.proposals;

      await repository.saveState(state);

      res.status(200).json({
        success: true,
        data: scanResult.summary,
        patterns: scanResult.patterns,
        proposals: scanResult.proposals,
        anomalyDaysFilteredCount: scanResult.anomalyDaysFilteredCount,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/v1/hee/adaptations/proposals/:id/approve
   * Approves adaptation proposal and applies versioned change
   */
  router.post('/adaptations/proposals/:id/approve', async (req: Request, res: Response, next: NextFunction) => {
    const proposalId = req.params.id;
    if (!proposalId) return next(new ValidationError('proposalId is required'));
    await processAuthoritativeCommand(req, res, next, () => new ApplyAdaptationProposalCommand({ proposalId }), options);
  });

  /**
   * POST /api/v1/hee/adaptations/proposals/:id/reject
   * Rejects adaptation proposal
   */
  router.post('/adaptations/proposals/:id/reject', async (req: Request, res: Response, next: NextFunction) => {
    const proposalId = req.params.id;
    if (!proposalId) return next(new ValidationError('proposalId is required'));
    await processAuthoritativeCommand(req, res, next, () => new RejectAdaptationProposalCommand({ proposalId }), options);
  });

  /**
   * POST /api/v1/hee/adaptations/proposals/:id/rollback
   * Reverts an applied adaptation to its exact previous version/configuration
   */
  router.post('/adaptations/proposals/:id/rollback', async (req: Request, res: Response, next: NextFunction) => {
    const proposalId = req.params.id;
    const { reason } = req.body || {};
    if (!proposalId) return next(new ValidationError('proposalId is required'));
    await processAuthoritativeCommand(req, res, next, () => new RollbackAdaptationProposalCommand({ proposalId, reason }), options);
  });

  /**
   * POST /api/v1/hee/adaptations/proposals/:id/measure
   * Evaluates post-adaptation performance against pre-adaptation baseline
   */
  router.post('/adaptations/proposals/:id/measure', async (req: Request, res: Response, next: NextFunction) => {
    const proposalId = req.params.id;
    if (!proposalId) return next(new ValidationError('proposalId is required'));
    await processAuthoritativeCommand(req, res, next, () => new EvaluateAdaptationMeasurementCommand({ proposalId }), options);
  });

  /**
   * POST /api/v1/hee/adaptations/proposals/:id/retain
   * Retains an adaptation proposal permanently after successful measurement
   */
  router.post('/adaptations/proposals/:id/retain', async (req: Request, res: Response, next: NextFunction) => {
    const proposalId = req.params.id;
    if (!proposalId) return next(new ValidationError('proposalId is required'));
    await processAuthoritativeCommand(req, res, next, () => new RetainAdaptationProposalCommand({ proposalId }), options);
  });

  /**
   * POST /api/v1/hee/adaptations/seed-history
   * Seeds historical execution data across 7, 30, 60, 90 days for testing and verification
   */
  router.post('/adaptations/seed-history', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const days = parseInt(req.body?.days || '90', 10);
      let state = await repository.loadState();
      state.historicalDays = generateLongitudinalExecutionHistory(days);
      await repository.saveState(state);

      res.status(200).json({
        success: true,
        message: `Successfully seeded ${days} days of longitudinal execution history`,
        seededDaysCount: state.historicalDays.length,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/proposals/:id/apply', async (req: Request, res: Response, next: NextFunction) => {
    const proposalId = req.params.id;
    if (!proposalId) return next(new ValidationError('proposalId is required'));
    await processAuthoritativeCommand(req, res, next, () => new ApplyAdaptationProposalCommand({ proposalId }), options);
  });

  router.post('/penalties/:id/accept', async (req: Request, res: Response, next: NextFunction) => {
    const taskId = req.params.id;
    const { penaltyPoints } = req.body || {};
    await processAuthoritativeCommand(req, res, next, () => new AcceptDisciplinePenaltyCommand({ taskId, penaltyPoints }), options);
  });

  // =========================================================================
  // 9. DURABLE EVENTS, AUDIT & EXPLAINABILITY (EOS-005)
  // =========================================================================

  /**
   * GET /api/v1/hee/events
   * Query durable event store
   */
  router.get('/events', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        eventTypes,
        correlationId,
        causationId,
        streamId,
        scope,
        fromTime,
        toTime,
        limit,
        offset
      } = req.query;

      const typesList = typeof eventTypes === 'string'
        ? (eventTypes.split(',') as any[])
        : undefined;

      const events = await defaultDurableEventStore.getEvents({
        eventTypes: typesList,
        correlationId: correlationId as string,
        causationId: causationId as string,
        streamId: streamId as string,
        scope: scope as string,
        fromTime: fromTime as string,
        toTime: toTime as string,
        limit: limit ? parseInt(limit as string, 10) : 100,
        offset: offset ? parseInt(offset as string, 10) : 0,
      });

      res.status(200).json({
        success: true,
        data: events,
        count: events.length,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/v1/hee/events/:id
   * Fetch single event envelope
   */
  router.get('/events/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const eventId = req.params.id;
      const event = await defaultDurableEventStore.getEventById(eventId);
      if (!event) {
        throw new ResourceNotFoundError(`Event not found: ${eventId}`);
      }

      res.status(200).json({
        success: true,
        data: event,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/v1/hee/events/:id/explain
   * Answers the 6 core questions from persisted system evidence:
   * 1. WHAT HAPPENED?
   * 2. WHY?
   * 3. WHAT CAUSED IT?
   * 4. WHICH ENGINE DECIDED?
   * 5. WHICH POLICY ALLOWED IT?
   * 6. WHAT STATE CHANGED?
   */
  router.get('/events/:id/explain', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const eventId = req.params.id;
      const explanation = await defaultExecutionAuditService.explainEvent(eventId);
      if (!explanation) {
        throw new ResourceNotFoundError(`Event not found for audit explanation: ${eventId}`);
      }

      res.status(200).json({
        success: true,
        data: explanation,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/v1/hee/events/:id/causal-tree
   * Returns causation DAG / ancestry tree
   */
  router.get('/events/:id/causal-tree', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const eventId = req.params.id;
      const tree = await defaultExecutionAuditService.getCausalTree(eventId);
      if (!tree) {
        throw new ResourceNotFoundError(`Event not found: ${eventId}`);
      }

      res.status(200).json({
        success: true,
        data: tree,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/v1/hee/dlq
   * List dead letter queue entries
   */
  router.get('/dlq', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status, consumerName, eventType } = req.query;
      const entries = await defaultDeadLetterQueue.list({
        status: status as any,
        consumerName: consumerName as string,
        eventType: eventType as string,
      });

      res.status(200).json({
        success: true,
        data: entries,
        count: entries.length,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/v1/hee/dlq/:id/dismiss
   */
  router.post('/dlq/:id/dismiss', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;
      await defaultDeadLetterQueue.dismiss(id);
      res.status(200).json({ success: true, message: `Entry ${id} dismissed` });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/v1/hee/chains/:chainType
   * Emits and registers one of the 9 critical event chains into durable storage
   */
  router.post('/chains/:chainType', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const chainType = req.params.chainType.toLowerCase();
      let result;

      switch (chainType) {
        case 'late-wake':
          result = defaultEventChainService.createLateWakeChain(req.body?.wakeTime || '06:35');
          break;
        case 'missed-activity':
          result = defaultEventChainService.createMissedActivityChain(req.body?.taskId, req.body?.taskTitle);
          break;
        case 'fallback':
          result = defaultEventChainService.createFallbackChain(req.body?.taskId, req.body?.taskTitle);
          break;
        case 'reallocation':
          result = defaultEventChainService.createReallocationChain();
          break;
        case 'trading-eligibility':
          result = defaultEventChainService.createTradingEligibilityChain(req.body?.isAuthorized ?? true);
          break;
        case 'human-override':
          result = defaultEventChainService.createHumanOverrideChain(req.body?.taskId, req.body?.reason);
          break;
        case 'adaptation-proposal':
          result = defaultEventChainService.createAdaptationProposalChain();
          break;
        case 'routine-change':
          result = defaultEventChainService.createRoutineChangeChain(req.body?.mode || 'RED');
          break;
        case 'tomorrow-activation':
          result = defaultEventChainService.createTomorrowActivationChain(req.body?.scheduleFocus);
          break;
        default:
          throw new ValidationError(`Unknown chain type: ${chainType}`);
      }

      await defaultDurableEventStore.appendBatch(result.events);
      await defaultEventDispatcher.dispatchBatch(result.events);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  });

  // =========================================================================
  // 10. BACKGROUND SCHEDULER & OFFLINE RECONCILIATION APIS (EOS-014)
  // =========================================================================

  /**
   * GET /api/v1/hee/scheduler/status
   * Inspects worker health, registered jobs, telemetry, and notification queue
   */
  router.get('/scheduler/status', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = await defaultBackgroundWorker.getStatus();
      res.status(200).json({
        success: true,
        data: status,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/v1/hee/scheduler/tick
   * Triggers an authoritative single-pass reconciliation tick
   */
  router.post('/scheduler/tick', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { forceDayBoundary, targetMinutes } = req.body || {};
      const result = await defaultBackgroundWorker.tick({
        forceDayBoundary: !!forceDayBoundary,
        targetMinutes: targetMinutes !== undefined ? Number(targetMinutes) : undefined,
        triggerOrigin: 'MANUAL_TRIGGER',
      });
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/v1/hee/scheduler/run-job
   * Runs a specific governed background job (e.g. DAY_BOUNDARY_TRANSITION, EXPIRED_ALLOCATION_DETECTION)
   */
  router.post('/scheduler/run-job', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { jobType } = req.body || {};
      if (!jobType) {
        throw new ValidationError('jobType is required');
      }
      const jobResult = await defaultBackgroundWorker.runJob(jobType);
      res.status(200).json({
        success: jobResult.success,
        data: jobResult,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/v1/hee/scheduler/toggle
   * Toggles background worker enabled/disabled status
   */
  router.post('/scheduler/toggle', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { enabled } = req.body || {};
      defaultBackgroundWorker.setEnabled(!!enabled);
      const status = await defaultBackgroundWorker.getStatus();
      res.status(200).json({
        success: true,
        data: status,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/v1/hee/scheduler/notifications
   * Fetches the durable notifications queue
   */
  router.get('/scheduler/notifications', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const state = await repository.loadState();
      res.status(200).json({
        success: true,
        data: {
          notifications: state.notifications || [],
          unreadCount: (state.notifications || []).filter(n => !n.read).length,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/v1/hee/scheduler/notifications/:id/read
   * Marks a notification as read
   */
  router.post('/scheduler/notifications/:id/read', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const notifId = req.params.id;
      const state = await repository.loadState();
      state.notifications = (state.notifications || []).map(n =>
        n.id === notifId ? { ...n, read: true } : n
      );
      await repository.saveState(state);
      res.status(200).json({
        success: true,
        data: { id: notifId, read: true },
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/v1/hee/scheduler/simulate-offline
   * Offline scenario test harness:
   * User plans tomorrow at 9 PM -> closes app -> sleeps -> tomorrow arrives -> opens app at target wake time
   */
  router.post('/scheduler/simulate-offline', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { wakeMinutes = 510, newDate } = req.body || {}; // 510 = 8:30 AM default
      const state = await repository.loadState();
      
      const targetDate = newDate || new Date(Date.now() + 86400000).toISOString().split('T')[0];
      
      // Simulate state offline reconciliation
      const customClock: IClock = {
        now: () => new Date(`${targetDate}T08:30:00.000Z`),
        toISOString: () => `${targetDate}T08:30:00.000Z`,
        getCurrentTimeMinutes: () => Number(wakeMinutes),
        getTimeString: () => '08:30',
        formatTime12Hour: () => '8:30 AM',
      };

      const reconciliation = reconcileLifecycleState(state, customClock, {
        forceDayBoundary: true,
        targetMinutes: Number(wakeMinutes),
        triggerOrigin: 'OFFLINE_RECOVERY',
      });

      await repository.saveState(reconciliation.state);

      res.status(200).json({
        success: true,
        data: {
          reconciliation: reconciliation.result,
          state: reconciliation.state,
          events: reconciliation.events,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  // =========================================================================
  // 9. CROSS-DEVICE SYNCHRONIZATION & CONTINUITY (EOS-003, EOS-004, EOS-014)
  // =========================================================================

  /**
   * POST /api/v1/hee/sync/pull
   * Pulls authoritative state and device updates for cross-device convergence
   */
  router.post('/sync/pull', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { lastVersion, deviceId } = req.body || {};
      const state = await repository.loadState();
      const currentVersion = (state as any).version || 1;

      // Update device heartbeat if deviceId provided
      if (deviceId) {
        const devices: DeviceProfile[] = state.registeredDevices || [];
        const existingIdx = devices.findIndex(d => d.id === deviceId);
        if (existingIdx >= 0) {
          devices[existingIdx] = {
            ...devices[existingIdx],
            lastSeenAt: new Date().toISOString(),
          };
        } else {
          devices.push({
            id: deviceId,
            name: `Device ${deviceId}`,
            type: deviceId.includes('mobile') ? 'MOBILE' : 'DESKTOP',
            lastSeenAt: new Date().toISOString(),
            isCurrentDevice: false,
            appVersion: '1.8.0',
          });
        }
        state.registeredDevices = devices;
        await repository.saveState(state);
      }

      res.status(200).json({
        success: true,
        state,
        version: currentVersion,
        serverTime: new Date().toISOString(),
        devices: state.registeredDevices || [],
        conflictsResolved: state.conflictLog?.slice(0, 10) || [],
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/v1/hee/sync/push
   * Pushes a batch of queued commands with idempotency and conflict resolution
   */
  router.post('/sync/push', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { commands = [], baseVersion, deviceId = 'unknown-device' } = req.body || {};
      let currentState = await repository.loadState();
      const appService = new ExecutionApplicationService(repository, clock);
      const idempotencyStore = defaultIdempotencyStore;
      const resolvedConflicts: ConflictResolutionRecord[] = [];

      for (const item of commands as SyncQueueItem[]) {
        const { idempotencyKey, commandType, payload } = item;

        // 1. Idempotency Check
        if (idempotencyKey) {
          const cached = idempotencyStore.get(idempotencyKey);
          if (cached) {
            continue; // Safely skip replay
          }
        }

        // 2. Conflict Handling & Command Execution
        if (commandType === 'CompleteActivityCommand' || commandType === 'COMPLETE_ACTIVITY') {
          const taskId = payload?.taskId;
          const existingTask = currentState.tasks.find(t => t.id === taskId);

          if (existingTask && existingTask.completed) {
            // Task already completed on another device -> Idempotent No-Op
            const record: ConflictResolutionRecord = {
              id: `conflict_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
              timestamp: new Date().toISOString(),
              conflictType: 'CONCURRENT_ACTIVITY_COMPLETION',
              entityId: taskId,
              entityName: existingTask.title,
              deviceA: deviceId,
              deviceB: 'Authoritative Server',
              strategy: 'IDEMPOTENT_NOOP',
              resolutionSummary: `Activity "${existingTask.title}" was already completed. Duplicate completion from ${deviceId} safely converged without double reward/penalty.`,
              resolvedStateVersion: (currentState.version || 1),
            };
            resolvedConflicts.push(record);
            continue;
          } else {
            const cmd = new CompleteActivityCommand(payload);
            const res = await appService.dispatch(cmd, currentState);
            if (res.success && res.state) {
              currentState = res.state;
            }
          }
        } else if (commandType === 'PlanTomorrowCommand' || commandType === 'PLAN_TOMORROW') {
          const incomingPlan: any = payload?.plan || {};
          const currentPlan: any = currentState.tomorrowPlan || {};

          // Check if server already has a newer plan and this is an outdated submission
          const incomingTimestamp = incomingPlan.lastPlannedAt || '1970-01-01T00:00:00.000Z';
          const currentTimestamp = currentPlan.lastPlannedAt || '1970-01-01T00:00:00.000Z';

          if (currentTimestamp > incomingTimestamp && Object.keys(currentPlan).length > 0) {
            // Outdated tomorrow plan detected: 3-way merge protecting newer fields
            const mergedPlan = {
              ...incomingPlan,
              ...currentPlan,
              wakeTime: currentPlan.wakeTime || incomingPlan.wakeTime,
              targetMode: currentPlan.targetMode || incomingPlan.targetMode,
              plannedTasks: currentPlan.plannedTasks?.length ? currentPlan.plannedTasks : incomingPlan.plannedTasks,
              companyPriorities: currentPlan.companyPriorities || incomingPlan.companyPriorities,
              familyCommitments: currentPlan.familyCommitments || incomingPlan.familyCommitments,
              lastPlannedAt: currentTimestamp,
            };

            const record: ConflictResolutionRecord = {
              id: `conflict_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
              timestamp: new Date().toISOString(),
              conflictType: 'OUTDATED_TOMORROW_PLAN',
              entityId: 'tomorrow-plan',
              entityName: 'Tomorrow Blueprint',
              deviceA: deviceId,
              deviceB: 'Authoritative Server',
              strategy: 'THREE_WAY_MERGE',
              resolutionSummary: `Merged outdated plan from ${deviceId} with authoritative plan from server while preserving non-negotiables.`,
              resolvedStateVersion: (currentState.version || 1),
            };
            resolvedConflicts.push(record);

            const cmd = new PlanTomorrowCommand({ plan: mergedPlan });
            const res = await appService.dispatch(cmd, currentState);
            if (res.success && res.state) {
              currentState = res.state;
            }
          } else {
            const cmd = new PlanTomorrowCommand({ plan: incomingPlan });
            const res = await appService.dispatch(cmd, currentState);
            if (res.success && res.state) {
              currentState = res.state;
            }
          }
        } else if (commandType === 'AdjustActivityCommand' || commandType === 'ADJUST_ACTIVITY') {
          const taskId = payload?.taskId;
          const targetTask = currentState.tasks.find(t => t.id === taskId);
          const cmd = new AdjustActivityCommand(payload);
          const res = await appService.dispatch(cmd, currentState);
          if (res.success && res.state) {
            currentState = res.state;
          }
        } else if (commandType === 'StartActivityCommand' || commandType === 'START_ACTIVITY') {
          const cmd = new StartActivityCommand(payload);
          const res = await appService.dispatch(cmd, currentState);
          if (res.success && res.state) currentState = res.state;
        } else if (commandType === 'PauseActivityCommand' || commandType === 'PAUSE_ACTIVITY') {
          const cmd = new PauseActivityCommand(payload);
          const res = await appService.dispatch(cmd, currentState);
          if (res.success && res.state) currentState = res.state;
        } else if (commandType === 'ResumeActivityCommand' || commandType === 'RESUME_ACTIVITY') {
          const cmd = new ResumeActivityCommand(payload);
          const res = await appService.dispatch(cmd, currentState);
          if (res.success && res.state) currentState = res.state;
        } else if (commandType === 'ActivateDayCommand' || commandType === 'ACTIVATE_DAY') {
          const cmd = new ActivateDayCommand(payload);
          const res = await appService.dispatch(cmd, currentState);
          if (res.success && res.state) currentState = res.state;
        } else if (commandType === 'SetSystemModeCommand' || commandType === 'SET_SYSTEM_MODE') {
          const cmd = new SetSystemModeCommand(payload);
          const res = await appService.dispatch(cmd, currentState);
          if (res.success && res.state) currentState = res.state;
        } else if (commandType === 'SetDayTypeCommand' || commandType === 'SET_DAY_TYPE') {
          const cmd = new SetDayTypeCommand(payload);
          const res = await appService.dispatch(cmd, currentState);
          if (res.success && res.state) currentState = res.state;
        } else if (commandType === 'AcceptDisciplinePenaltyCommand' || commandType === 'ACCEPT_DISCIPLINE_PENALTY') {
          const cmd = new AcceptDisciplinePenaltyCommand(payload);
          const res = await appService.dispatch(cmd, currentState);
          if (res.success && res.state) currentState = res.state;
        }

        // Cache in idempotency store
        if (idempotencyKey) {
          idempotencyStore.set(idempotencyKey, 200, { success: true, timestamp: new Date().toISOString() });
        }
      }

      // 3. Finalize Aggregate State & Increment Version
      const nextVersion = ((currentState as any).version || 1) + 1;
      const existingConflictLog = currentState.conflictLog || [];
      const updatedConflictLog = [...resolvedConflicts, ...existingConflictLog].slice(0, 50);

      // Update registered devices heartbeat
      const devices = currentState.registeredDevices || [];
      const devIdx = devices.findIndex(d => d.id === deviceId);
      if (devIdx >= 0) {
        devices[devIdx] = { ...devices[devIdx], lastSeenAt: new Date().toISOString() };
      } else {
        devices.push({
          id: deviceId,
          name: `Device ${deviceId}`,
          type: deviceId.includes('mobile') ? 'MOBILE' : 'DESKTOP',
          lastSeenAt: new Date().toISOString(),
          isCurrentDevice: false,
          appVersion: '1.8.0',
        });
      }

      currentState = {
        ...currentState,
        version: nextVersion,
        conflictLog: updatedConflictLog,
        registeredDevices: devices,
      };

      await repository.saveState(currentState);

      res.status(200).json({
        success: true,
        state: currentState,
        version: nextVersion,
        resolvedConflicts,
        serverTime: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/v1/hee/sync/devices
   * Returns list of connected devices
   */
  router.get('/sync/devices', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const state = await repository.loadState();
      res.status(200).json({
        success: true,
        devices: state.registeredDevices || [],
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/v1/hee/sync/devices/register
   * Registers a new device or updates heartbeat
   */
  router.post('/sync/devices/register', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { device } = req.body || {};
      if (!device || !device.id) {
        return next(new ValidationError('Device profile with id is required.'));
      }

      const state = await repository.loadState();
      const devices = state.registeredDevices || [];
      const existingIdx = devices.findIndex(d => d.id === device.id);

      if (existingIdx >= 0) {
        devices[existingIdx] = { ...devices[existingIdx], ...device, lastSeenAt: new Date().toISOString() };
      } else {
        devices.push({ ...device, lastSeenAt: new Date().toISOString() });
      }

      state.registeredDevices = devices;
      await repository.saveState(state);

      res.status(200).json({
        success: true,
        devices,
      });
    } catch (err) {
      next(err);
    }
  });

  // =========================================================================
  // HEE-011 HUMAN PERFORMANCE ENGINE ENDPOINTS
  // =========================================================================

  /**
   * POST /api/v1/hee/performance/sessions
   * Create new performance session
   */
  router.post('/performance/sessions', mutationLimiter, async (req: Request, res: Response, next: NextFunction) => {
    const { activityInstanceId, environmentType, protocolId } = req.body || {};
    if (!activityInstanceId) {
      return next(new ValidationError('activityInstanceId is required.'));
    }
    await processAuthoritativeCommand(
      req,
      res,
      next,
      () => new CreatePerformanceSessionCommand({ activityInstanceId, environmentType, protocolId }),
      options
    );
  });

  /**
   * GET /api/v1/hee/performance/sessions
   * Get all performance sessions or active session
   */
  router.get('/performance/sessions', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const state = await repository.loadState();
      res.status(200).json({
        success: true,
        sessions: state.performanceSessions || [],
        activeSessionId: state.activePerformanceSessionId || null,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/v1/hee/performance/sessions/:id
   */
  router.get('/performance/sessions/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const state = await repository.loadState();
      const session = (state.performanceSessions || []).find(s => s.id === req.params.id);
      if (!session) return next(new ResourceNotFoundError(`Performance session ${req.params.id} not found.`));
      res.status(200).json({ success: true, session });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/v1/hee/performance/sessions/:id/prepare
   */
  router.post('/performance/sessions/:id/prepare', mutationLimiter, async (req: Request, res: Response, next: NextFunction) => {
    await processAuthoritativeCommand(
      req,
      res,
      next,
      () => new PreparePerformanceSessionCommand({ sessionId: req.params.id }),
      options
    );
  });

  /**
   * POST /api/v1/hee/performance/sessions/:id/ready
   */
  router.post('/performance/sessions/:id/ready', mutationLimiter, async (req: Request, res: Response, next: NextFunction) => {
    await processAuthoritativeCommand(
      req,
      res,
      next,
      () => new ReadyPerformanceSessionCommand({ sessionId: req.params.id }),
      options
    );
  });

  /**
   * POST /api/v1/hee/performance/sessions/:id/start
   */
  router.post('/performance/sessions/:id/start', mutationLimiter, async (req: Request, res: Response, next: NextFunction) => {
    await processAuthoritativeCommand(
      req,
      res,
      next,
      () => new StartPerformanceSessionCommand({ sessionId: req.params.id }),
      options
    );
  });

  /**
   * POST /api/v1/hee/performance/sessions/:id/pause
   */
  router.post('/performance/sessions/:id/pause', mutationLimiter, async (req: Request, res: Response, next: NextFunction) => {
    await processAuthoritativeCommand(
      req,
      res,
      next,
      () => new PausePerformanceSessionCommand({ sessionId: req.params.id }),
      options
    );
  });

  /**
   * POST /api/v1/hee/performance/sessions/:id/resume
   */
  router.post('/performance/sessions/:id/resume', mutationLimiter, async (req: Request, res: Response, next: NextFunction) => {
    await processAuthoritativeCommand(
      req,
      res,
      next,
      () => new ResumePerformanceSessionCommand({ sessionId: req.params.id }),
      options
    );
  });

  /**
   * POST /api/v1/hee/performance/sessions/:id/progress
   */
  router.post('/performance/sessions/:id/progress', mutationLimiter, async (req: Request, res: Response, next: NextFunction) => {
    const { stepIndex, quantity, branchSelectedId, notes } = req.body || {};
    await processAuthoritativeCommand(
      req,
      res,
      next,
      () => new AdvancePerformanceStepCommand({
        sessionId: req.params.id,
        stepIndex: Number(stepIndex),
        quantity,
        branchSelectedId,
        notes
      }),
      options
    );
  });

  /**
   * POST /api/v1/hee/performance/sessions/:id/artifacts
   */
  router.post('/performance/sessions/:id/artifacts', mutationLimiter, async (req: Request, res: Response, next: NextFunction) => {
    const { artifactType, title, uriOrRef, contentSnippet, provenance } = req.body || {};
    if (!artifactType || !title) {
      return next(new ValidationError('artifactType and title are required.'));
    }
    await processAuthoritativeCommand(
      req,
      res,
      next,
      () => new AttachPerformanceArtifactCommand({
        sessionId: req.params.id,
        artifactType,
        title,
        uriOrRef,
        contentSnippet,
        provenance
      }),
      options
    );
  });

  /**
   * POST /api/v1/hee/performance/sessions/:id/evidence
   */
  router.post('/performance/sessions/:id/evidence', mutationLimiter, async (req: Request, res: Response, next: NextFunction) => {
    const { type, source, trustLevel, payload } = req.body || {};
    if (!type) return next(new ValidationError('evidence type is required.'));
    await processAuthoritativeCommand(
      req,
      res,
      next,
      () => new RecordPerformanceEvidenceCommand({
        sessionId: req.params.id,
        type,
        source: source || 'USER',
        trustLevel: trustLevel || 'E1',
        payload: payload || {}
      }),
      options
    );
  });

  /**
   * POST /api/v1/hee/performance/sessions/:id/extension
   */
  router.post('/performance/sessions/:id/extension', mutationLimiter, async (req: Request, res: Response, next: NextFunction) => {
    const { requestedMinutes, reason } = req.body || {};
    if (!requestedMinutes) return next(new ValidationError('requestedMinutes is required.'));
    await processAuthoritativeCommand(
      req,
      res,
      next,
      () => new RequestPerformanceExtensionCommand({
        sessionId: req.params.id,
        requestedMinutes: Number(requestedMinutes),
        reason: reason || 'More focus time needed'
      }),
      options
    );
  });

  /**
   * POST /api/v1/hee/performance/sessions/:id/close
   */
  router.post('/performance/sessions/:id/close', mutationLimiter, async (req: Request, res: Response, next: NextFunction) => {
    const { outcome, reason, qualityAssessment } = req.body || {};
    if (!outcome) return next(new ValidationError('outcome is required.'));
    await processAuthoritativeCommand(
      req,
      res,
      next,
      () => new ClosePerformanceSessionCommand({
        sessionId: req.params.id,
        outcome,
        reason,
        qualityAssessment
      }),
      options
    );
  });

  /**
   * POST /api/v1/hee/performance/sessions/:id/cancel
   */
  router.post('/performance/sessions/:id/cancel', mutationLimiter, async (req: Request, res: Response, next: NextFunction) => {
    const { reason } = req.body || {};
    await processAuthoritativeCommand(
      req,
      res,
      next,
      () => new CancelPerformanceSessionCommand({
        sessionId: req.params.id,
        reason: reason || 'Cancelled by user'
      }),
      options
    );
  });

  router.post('/state/reset', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const resetState = await repository.reset();
      res.status(200).json({
        success: true,
        data: resetState,
        version: 1,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
