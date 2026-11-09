import { Router, Request } from 'express';
import { ExecutionApplicationService } from '../../services/executionApplicationService';
import { IHOSRepositoryFactory } from '../../hos/repositoryFactory';
import { HOSEventMeshBridge } from '../../hos/eventMesh';
import { IHOSBoundaryStore } from '../../hos/boundaryStore';
import { HOSSubjectContext, HOSIdentityBridge } from '../../hos/identityBridge';
import { HOSSubjectRuntimeRegistry } from '../../hos/runtimeRegistry';
import { AuthenticationError, AuthorizationError, ValidationError } from '../errors';

const CLIENT_COMMANDS = new Set([
  'PlanTomorrow','ActivateDay','LateWakeRecovery',
  'StartActivity','PauseActivity','ResumeActivity','CompleteActivity','AdjustActivity',
  'AdvanceActivity','DeferActivity','CompressActivity','ReplaceActivity','OverrideActivity',
  'RecalculateDay','ApproveDecision','RejectDecision','PauseAutonomy','ResumeAutonomy',
  'SetSystemMode','SetDayType','TriggerFallback','ApplyAdaptationProposal',
  'RollbackAdaptationProposal','RetainAdaptationProposal','RejectAdaptationProposal',
  'EvaluateAdaptationMeasurement','AcceptDisciplinePenalty','RecordTradingProtocol',
  'RecordCompanyOfTheDay','RecordDailyReview','RecordIdentityStatus','RecordExecutionProgress',
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
  if (['TriggerFallback','ApplyAdaptationProposal','RollbackAdaptationProposal','RetainAdaptationProposal','RejectAdaptationProposal','EvaluateAdaptationMeasurement'].includes(type)) {
    HOSIdentityBridge.requirePermission(subject, 'execution.fallback.write');
    HOSIdentityBridge.requireConsent(subject, 'execution.adaptation');
    return;
  }
  if (['PauseAutonomy','ResumeAutonomy','OverrideActivity'].includes(type)) {
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
