import { Router, Request, Response, NextFunction } from 'express';
import { ExecutionApplicationService } from '../../services/executionApplicationService';
import { HOS_ENGINE_MANIFEST } from '../../hos/engineManifest';
import { HOSIdentityBridge, HOSSubjectContext } from '../../hos/identityBridge';
import {
  IHOSRepositoryFactory,
  HOSSubjectScopedRepositoryFactory,
} from '../../hos/repositoryFactory';
import {
  HOSEventMeshBridge,
  defaultHOSEventMeshBridge,
} from '../../hos/eventMesh';
import {
  HOSEngineLifecycleRegistry,
  defaultHOSEngineLifecycleRegistry,
} from '../../hos/lifecycle';
import { HOSCapabilityService } from '../../hos/capabilityService';
import { ApiError, AuthenticationError, ValidationError } from '../errors';

function subjectFrom(req: Request): HOSSubjectContext {
  if (!req.hosSubject) {
    throw new AuthenticationError('HumanKernelOS subject assertion is required for this integration endpoint.');
  }
  return req.hosSubject;
}

export function createHOSRouter(
  repositories: IHOSRepositoryFactory = new HOSSubjectScopedRepositoryFactory(),
  eventMesh: HOSEventMeshBridge = defaultHOSEventMeshBridge,
  lifecycle: HOSEngineLifecycleRegistry = defaultHOSEngineLifecycleRegistry
): Router {
  const router = Router();
  const capabilities = new HOSCapabilityService(repositories, eventMesh, lifecycle);
  const signalIdempotency = new Map<string, { fingerprint: string; response: any }>();

  router.get('/manifest', (_req, res) => {
    res.status(200).json({ success: true, data: HOS_ENGINE_MANIFEST });
  });

  router.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      engineId: HOS_ENGINE_MANIFEST.engineId,
      contractVersion: HOS_ENGINE_MANIFEST.contractVersion,
      identityAuthority: HOS_ENGINE_MANIFEST.identityAuthority,
      scheduleAuthority: HOS_ENGINE_MANIFEST.scheduleAuthority,
      eventMeshConfigured: Boolean(process.env.HOS_EVENT_MESH_URL),
      timestamp: new Date().toISOString(),
    });
  });

  router.get('/whoami', (req, res, next) => {
    try {
      const subject = subjectFrom(req);
      res.status(200).json({
        success: true,
        data: {
          subjectId: subject.subjectId,
          hosUserId: subject.hosUserId,
          tenantId: subject.tenantId,
          issuer: subject.issuer,
          permissions: subject.permissions,
          consentScopes: subject.consentScopes,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/lifecycle', (req, res, next) => {
    try {
      const subject = subjectFrom(req);
      res.status(200).json({ success: true, data: lifecycle.get(subject) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/lifecycle', (req, res, next) => {
    try {
      const subject = subjectFrom(req);
      HOSIdentityBridge.requirePermission(subject, 'execution.lifecycle.manage');
      HOSIdentityBridge.requireConsent(subject, 'execution.control');

      const action = String(req.body?.action || '').toUpperCase();
      const nextState =
        action === 'ACTIVATE' || action === 'RESUME' ? 'ACTIVE' :
        action === 'PAUSE' ? 'PAUSED' :
        action === 'DEGRADE' ? 'DEGRADED' : null;

      if (!nextState) throw new ValidationError('Lifecycle action must be ACTIVATE, RESUME, PAUSE, or DEGRADE.');
      const record = lifecycle.set(subject, nextState, req.body?.reason);
      res.status(200).json({ success: true, data: record });
    } catch (err) {
      next(err);
    }
  });

  router.post('/signals', async (req, res, next) => {
    try {
      const subject = subjectFrom(req);
      const type = String(req.body?.type || '');
      const payload = req.body?.data || {};
      const idempotencyKey = String(req.headers['idempotency-key'] || req.headers['x-idempotency-key'] || '');
      if (!idempotencyKey) throw new ValidationError('HOS signals require an Idempotency-Key.');

      const scopedKey = `${subject.tenantId}::${subject.subjectId}::${type}::${idempotencyKey}`;
      const fingerprint = JSON.stringify(payload);
      const cached = signalIdempotency.get(scopedKey);
      if (cached) {
        if (cached.fingerprint !== fingerprint) {
          throw new ValidationError('Idempotency key reuse detected with a different HOS signal payload.');
        }
        res.setHeader('X-Idempotent-Replay', 'true');
        return res.status(200).json({ ...cached.response, metadata: { idempotentReplay: true } });
      }

      const repository = repositories.forSubject(subject);
      let state = await repository.loadState();
      if (state.subjectId && state.subjectId !== subject.subjectId) {
        throw new ValidationError('Subject-scoped repository contains a different execution subject.');
      }
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

      const app = new ExecutionApplicationService(repository);
      let result: any;

      if (type === 'hos.daily_operating_plan.updated') {
        HOSIdentityBridge.requirePermission(subject, 'execution.schedule.write');
        HOSIdentityBridge.requireConsent(subject, 'execution.schedule');
        if (!payload?.plan || payload.plan.subjectId !== subject.subjectId) {
          throw new ValidationError('HOS Daily Operating Plan must exist and match the authenticated subject.');
        }
        result = await app.execute({ type: 'SetHOSOperatingPlan', payload: { plan: payload.plan } }, state);
      } else if (type === 'hos.schedule_proposal.resolved') {
        HOSIdentityBridge.requirePermission(subject, 'execution.schedule.write');
        HOSIdentityBridge.requireConsent(subject, 'execution.schedule');
        result = await app.execute({
          type: 'ResolveScheduleProposal',
          payload: { proposalId: payload.proposalId, decision: payload.decision },
        }, state);
      } else if (type === 'hos.external_execution_gate.updated') {
        HOSIdentityBridge.requirePermission(subject, 'execution.gate.write');
        HOSIdentityBridge.requireConsent(subject, 'execution.control');
        result = await app.execute({ type: 'UpsertExternalExecutionGate', payload: { gate: payload.gate } }, state);
      } else {
        throw new ValidationError(`Unsupported HOS signal type "${type}".`);
      }

      if (!result?.success) throw new ValidationError(result?.error || 'HOS signal application failed.');
      await eventMesh.publishBatch(result.events || [], subject);

      const response = {
        success: true,
        data: {
          signalType: type,
          subjectId: subject.subjectId,
          scheduleAuthority: result.state.scheduleAuthority,
          scheduleProposals: result.state.scheduleProposals || [],
          externalExecutionGates: result.state.externalExecutionGates || [],
        },
        events: result.events || [],
      };
      signalIdempotency.set(scopedKey, { fingerprint, response: JSON.parse(JSON.stringify(response)) });
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  });

  router.post('/capabilities/:capability', async (req, res, next) => {
    try {
      const subject = subjectFrom(req);
      const result = await capabilities.execute(
        req.params.capability,
        req.body || {},
        subject,
        String(req.headers['idempotency-key'] || req.headers['x-idempotency-key'] || '') || undefined
      );
      if (result.idempotentReplay) res.setHeader('X-Idempotent-Replay', 'true');
      res.status(200).json({ success: true, data: result });
    } catch (err: any) {
      if (err instanceof ApiError) return next(err);
      next(new ValidationError(err?.message || 'HOS capability execution failed.'));
    }
  });

  router.get('/events/audit', (req, res, next) => {
    try {
      const subject = subjectFrom(req);
      HOSIdentityBridge.requirePermission(subject, 'execution.events.read');
      HOSIdentityBridge.requireConsent(subject, 'execution.audit');
      res.status(200).json({ success: true, data: eventMesh.listAudit(subject) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/events/dlq', async (req, res, next) => {
    try {
      const subject = subjectFrom(req);
      HOSIdentityBridge.requirePermission(subject, 'execution.events.manage');
      HOSIdentityBridge.requireConsent(subject, 'execution.audit');
      res.status(200).json({ success: true, data: await eventMesh.listDeadLetters(subject) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/events/dlq/:id/retry', async (req, res, next) => {
    try {
      const subject = subjectFrom(req);
      HOSIdentityBridge.requirePermission(subject, 'execution.events.manage');
      HOSIdentityBridge.requireConsent(subject, 'execution.audit');

      const visible = await eventMesh.listDeadLetters(subject);
      if (!visible.some(entry => entry.id === req.params.id)) {
        throw new ValidationError('Dead-letter entry does not belong to the authenticated HOS subject.');
      }
      res.status(200).json({ success: true, data: await eventMesh.retryDeadLetter(req.params.id) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
