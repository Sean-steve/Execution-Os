import { Router, Request } from 'express';
import { ExecutionApplicationService } from '../../services/executionApplicationService';
import { IHOSRepositoryFactory } from '../../hos/repositoryFactory';
import { HOSEventMeshBridge } from '../../hos/eventMesh';
import { IHOSBoundaryStore } from '../../hos/boundaryStore';
import { HOSSubjectContext, HOSIdentityBridge } from '../../hos/identityBridge';
import { HOSSubjectRuntimeRegistry } from '../../hos/runtimeRegistry';
import { AuthenticationError, AuthorizationError, ValidationError } from '../errors';
import { performanceAiPartner } from '../../services/performanceAiPartner';
import { BackgroundJobType } from '../../types';

const CLIENT_COMMANDS = new Set([
  'PlanTomorrow','ActivateDay','LateWakeRecovery',
  'StartActivity','PauseActivity','ResumeActivity','CompleteActivity','AdjustActivity',
  'AdvanceActivity','DeferActivity','CompressActivity','ReplaceActivity','OverrideActivity',
  'RecalculateDay','ApproveDecision','RejectDecision','PauseAutonomy','ResumeAutonomy',
  'SetSystemMode','SetDayType','TriggerFallback','ApplyAdaptationProposal',
  'RollbackAdaptationProposal','RetainAdaptationProposal','RejectAdaptationProposal',
  'EvaluateAdaptationMeasurement','ScanAdaptations','AcceptDisciplinePenalty','RecordTradingProtocol',
  'RecordCompanyOfTheDay','RecordDailyReview','RecordIdentityStatus','RecordExecutionProgress',
  'SetStrictTimeEnforcement','CreateReward',
  'CreatePerformanceSession','PreparePerformanceSession','ReadyPerformanceSession',
  'StartPerformanceSession','PausePerformanceSession','ResumePerformanceSession',
  'AdvancePerformanceStep','AttachPerformanceArtifact','RecordPerformanceEvidence',
  'RequestPerformanceExtension','ClosePerformanceSession','CancelPerformanceSession',
  'RedeemReward'
]);

function subjectFrom(req: Request): HOSSubjectContext {
  if (!req.hosSubject || req.user?.identitySource !== 'HOS_CLIENT') {
    throw new AuthenticationError('A delegated HumanKernelOS client session is required.');
  }
  return req.hosSubject;
}

function stableFingerprint(value: any): string {
  if (Array.isArray(value)) return JSON.stringify(value.map(v => JSON.parse(stableFingerprint(v))));
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const key of Object.keys(value).sort()) out[key] = value[key];
    return JSON.stringify(out);
  }
  return JSON.stringify(value);
}

function requireAnyPermission(subject: HOSSubjectContext, permissions: string[]) {
  if (!permissions.some(permission => subject.permissions.includes(permission))) {
    throw new AuthorizationError('The delegated HOS client session does not permit this Execution OS operation.', {
      requiredAnyPermission: permissions,
      subjectId: subject.subjectId,
    });
  }
}

function requireAnyConsent(subject: HOSSubjectContext, scopes: string[]) {
  if (!scopes.some(scope => subject.consentScopes.includes(scope))) {
    throw new AuthorizationError('The delegated HOS client session does not contain the required consent scope.', {
      requiredAnyConsentScope: scopes,
      subjectId: subject.subjectId,
    });
  }
}

function assertCommandAuthority(subject: HOSSubjectContext, type: string) {
  if (['PlanTomorrow','ActivateDay','LateWakeRecovery','AdjustActivity','AdvanceActivity','DeferActivity','CompressActivity','ReplaceActivity','RecalculateDay','SetSystemMode','SetDayType'].includes(type)) {
    HOSIdentityBridge.requirePermission(subject, 'execution.schedule.write');
    HOSIdentityBridge.requireConsent(subject, 'execution.schedule');
    return;
  }
  if (['TriggerFallback','ApplyAdaptationProposal','RollbackAdaptationProposal','RetainAdaptationProposal','RejectAdaptationProposal','EvaluateAdaptationMeasurement','ScanAdaptations'].includes(type)) {
    HOSIdentityBridge.requirePermission(subject, 'execution.fallback.write');
    HOSIdentityBridge.requireConsent(subject, 'execution.adaptation');
    return;
  }
  if (['PauseAutonomy','ResumeAutonomy','OverrideActivity','SetStrictTimeEnforcement'].includes(type)) {
    HOSIdentityBridge.requirePermission(subject, 'execution.governance.write');
    HOSIdentityBridge.requireConsent(subject, 'execution.control');
    return;
  }
  requireAnyPermission(subject, ['execution.session.write','execution.schedule.write']);
  requireAnyConsent(subject, ['execution.performance','execution.schedule']);
}

async function loadBoundState(repository: any, subject: HOSSubjectContext) {
  let state = await repository.loadState();
  if (state.subjectId && state.subjectId !== subject.subjectId) {
    throw new ValidationError('Authoritative repository subject mismatch.');
  }
  if (state.tenantId && state.tenantId !== subject.tenantId) {
    throw new ValidationError('Authoritative repository tenant mismatch.');
  }
  if (!state.subjectId || !state.tenantId) {
    state = {
      ...state,
      subjectId: subject.subjectId,
      tenantId: subject.tenantId,
      hosIdentityBinding: {
        hosUserId: subject.hosUserId,
        tenantId: subject.tenantId,
        issuer: 'HumanKernelOS',
        boundAtUtc: state.hosIdentityBinding?.boundAtUtc || new Date().toISOString(),
        lastAuthenticatedAtUtc: subject.authenticatedAtUtc,
      },
    };
    await repository.saveState(state);
  }
  return state;
}

export function createClientRouter(
  repositories: IHOSRepositoryFactory,
  eventMesh: HOSEventMeshBridge,
  boundaryStore: IHOSBoundaryStore,
  runtime?: HOSSubjectRuntimeRegistry
): Router {
  const router = Router();

  router.get('/state', async (req, res, next) => {
    try {
      const subject = subjectFrom(req);
      requireAnyPermission(subject, ['execution.schedule.read','execution.discipline.read','execution.session.write']);
      requireAnyConsent(subject, ['execution.schedule','execution.analytics','execution.performance']);
      runtime?.ensureForSubject(subject);
      const repository = repositories.forSubject(subject);
      const state = await loadBoundState(repository, subject);
      res.status(200).json({ success: true, state, version: state.version || 1 });
    } catch (err) {
      next(err);
    }
  });

  router.get('/runtime', (req, res, next) => {
    try {
      const subject = subjectFrom(req);
      res.status(200).json({ success: true, data: runtime?.status(subject) || null });
    } catch (err) {
      next(err);
    }
  });

  router.get('/scheduler/status', async (req, res, next) => {
    try {
      const subject = subjectFrom(req);
      HOSIdentityBridge.requirePermission(subject, 'execution.schedule.read');
      HOSIdentityBridge.requireConsent(subject, 'execution.schedule');
      const data = await runtime?.schedulerStatus(subject);
      res.status(200).json({ success: true, data: data || null });
    } catch (err) {
      next(err);
    }
  });

  router.post('/scheduler/tick', async (req, res, next) => {
    try {
      const subject = subjectFrom(req);
      HOSIdentityBridge.requirePermission(subject, 'execution.governance.write');
      HOSIdentityBridge.requireConsent(subject, 'execution.control');
      if (!runtime) throw new ValidationError('HOS runtime registry is unavailable.');
      const data = await runtime.triggerTick(subject, {
        forceDayBoundary: Boolean(req.body?.forceDayBoundary),
        targetMinutes: req.body?.targetMinutes === undefined ? undefined : Number(req.body.targetMinutes),
      });
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  });

  router.post('/scheduler/run-job', async (req, res, next) => {
    try {
      const subject = subjectFrom(req);
      HOSIdentityBridge.requirePermission(subject, 'execution.governance.write');
      HOSIdentityBridge.requireConsent(subject, 'execution.control');
      const jobType = req.body?.jobType as BackgroundJobType | undefined;
      if (!jobType) throw new ValidationError('jobType is required.');
      if (!runtime) throw new ValidationError('HOS runtime registry is unavailable.');
      const data = await runtime.runJob(subject, jobType);
      res.status(200).json({ success: data.success, data });
    } catch (err) {
      next(err);
    }
  });

  router.post('/scheduler/toggle', async (req, res, next) => {
    try {
      const subject = subjectFrom(req);
      HOSIdentityBridge.requirePermission(subject, 'execution.governance.write');
      HOSIdentityBridge.requireConsent(subject, 'execution.control');
      if (typeof req.body?.enabled !== 'boolean') throw new ValidationError('enabled must be boolean.');
      if (!runtime) throw new ValidationError('HOS runtime registry is unavailable.');
      const data = await runtime.setWorkerEnabled(subject, req.body.enabled);
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  });

  router.post('/notifications/:id/read', async (req, res, next) => {
    try {
      const subject = subjectFrom(req);
      HOSIdentityBridge.requirePermission(subject, 'execution.schedule.write');
      HOSIdentityBridge.requireConsent(subject, 'execution.schedule');
      const repository = repositories.forSubject(subject);
      const state = await loadBoundState(repository, subject);
      const id = req.params.id;
      state.notifications = (state.notifications || []).map(notification =>
        notification.id === id ? { ...notification, read: true } : notification
      );
      await repository.saveState(state);
      res.status(200).json({ success: true, state, data: { id, read: true } });
    } catch (err) {
      next(err);
    }
  });

  router.post('/performance/sessions/:id/ai', async (req, res, next) => {
    try {
      const subject = subjectFrom(req);
      HOSIdentityBridge.requirePermission(subject, 'execution.session.write');
      HOSIdentityBridge.requireConsent(subject, 'execution.performance');
      const repository = repositories.forSubject(subject);
      const state = await loadBoundState(repository, subject);
      const session = (state.performanceSessions || []).find(item => item.id === req.params.id);
      if (!session) throw new ValidationError('Performance session not found.');
      const message = String(req.body?.message || '').trim();
      if (!message) throw new ValidationError('message is required.');
      const mode = req.body?.mode || session.environmentConfig.aiMode;
      const data = await performanceAiPartner.respond({ session, state, message, mode });
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  });

  router.post('/commands', async (req, res, next) => {
    try {
      const subject = subjectFrom(req);
      const type = String(req.body?.type || '');
      const payload = req.body?.payload || {};
      if (!CLIENT_COMMANDS.has(type)) throw new ValidationError(`Unsupported E11 client command "${type}".`);
      assertCommandAuthority(subject, type);

      const idempotencyKey = String(req.headers['idempotency-key'] || '');
      if (!idempotencyKey) throw new ValidationError('Client commands require an Idempotency-Key.');

      const scopedKey = `client::${subject.tenantId}::${subject.subjectId}::${type}::${idempotencyKey}`;
      const fingerprint = stableFingerprint(payload);
      const cached = boundaryStore.getIdempotency(scopedKey);
      if (cached) {
        if (cached.fingerprint !== fingerprint) {
          throw new ValidationError('Idempotency-Key reuse detected with a different command payload.');
        }
        res.setHeader('X-Idempotent-Replay', 'true');
        return res.status(200).json(cached.response);
      }

      runtime?.ensureForSubject(subject);
      const repository = repositories.forSubject(subject);
      const state = await loadBoundState(repository, subject);

      const app = new ExecutionApplicationService(repository);
      const result = await app.execute({ type, payload }, state);
      if (!result.success) throw new ValidationError(result.error || 'Execution command failed.');

      await eventMesh.publishBatch(result.events || [], subject);
      const response = {
        success: true,
        state: result.state,
        events: result.events || [],
        version: result.state?.version || state.version || 1,
      };
      boundaryStore.setIdempotency(scopedKey, {
        fingerprint,
        response: JSON.parse(JSON.stringify(response)),
        createdAtUtc: new Date().toISOString(),
      });
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
