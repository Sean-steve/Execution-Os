import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createApp } from '../server/createApp';
import { HOSIdentityAssertion, HOSIdentityBridge, HOSSubjectContext } from '../hos/identityBridge';
import { IHOSRepositoryFactory, HOSSubjectScopedRepositoryFactory } from '../hos/repositoryFactory';
import { InMemoryExecutionRepository } from '../repositories/implementations';
import { IExecutionRepository } from '../repositories';
import { createEmptyExecutionState } from '../data/defaultData';
import { LEGACY_STANDALONE_FIXTURE_STATE } from './fixtures/legacyStandaloneProfile';
import {
  HOSEventMeshBridge,
  IHOSEventMeshTransport,
  MemoryHOSEventMeshTransport,
} from '../hos/eventMesh';
import { FileDeadLetterQueue, MemoryDeadLetterQueue } from '../services/deadLetterQueue';
import { HOSEngineLifecycleRegistry } from '../hos/lifecycle';
import { SystemEvent } from '../types';
import { FileHOSBoundaryStore, MemoryHOSBoundaryStore } from '../hos/boundaryStore';

class TestSubjectRepositoryFactory implements IHOSRepositoryFactory {
  private repos = new Map<string, IExecutionRepository>();

  private key(subject: HOSSubjectContext) {
    return `${subject.tenantId}::${subject.subjectId}`;
  }

  forSubject(subject: HOSSubjectContext): IExecutionRepository {
    const key = this.key(subject);
    if (!this.repos.has(key)) {
      this.repos.set(key, new InMemoryExecutionRepository(createEmptyExecutionState()));
    }
    return this.repos.get(key)!;
  }

  async seed(subject: HOSSubjectContext, state: any) {
    await this.forSubject(subject).saveState(JSON.parse(JSON.stringify(state)));
  }
}

const ALL_PERMISSIONS = [
  'execution.schedule.read',
  'execution.schedule.write',
  'execution.session.write',
  'execution.fallback.write',
  'execution.discipline.read',
  'execution.lifecycle.manage',
  'execution.gate.write',
  'execution.events.read',
  'execution.events.manage',
];

const ALL_CONSENT = [
  'execution.schedule',
  'execution.performance',
  'execution.adaptation',
  'execution.analytics',
  'execution.control',
  'execution.audit',
];

function assertionFor(
  subjectId: string,
  permissions = ALL_PERMISSIONS,
  consentScopes = ALL_CONSENT,
  tenantId = 'tenant-hos'
): HOSIdentityAssertion {
  return {
    subjectId,
    tenantId,
    permissions,
    consentScopes,
    issuedAt: new Date().toISOString(),
  };
}

function headersFor(assertion: HOSIdentityAssertion) {
  return {
    'x-hos-subject': assertion.subjectId,
    'x-hos-tenant': assertion.tenantId,
    'x-hos-permissions': assertion.permissions.join(','),
    'x-hos-consent': assertion.consentScopes.join(','),
    'x-hos-issued-at': assertion.issuedAt,
    'x-hos-signature': HOSIdentityBridge.signAssertion(assertion),
  };
}

function contextFor(assertion: HOSIdentityAssertion): HOSSubjectContext {
  return HOSIdentityBridge.verifyAssertion(assertion, HOSIdentityBridge.signAssertion(assertion));
}

describe('HumanKernelOS E4-E6 Integration Certification', () => {
  let factory: TestSubjectRepositoryFactory;
  let transport: MemoryHOSEventMeshTransport;
  let bridge: HOSEventMeshBridge;
  let lifecycle: HOSEngineLifecycleRegistry;
  let boundaryStore: MemoryHOSBoundaryStore;
  let app: any;

  beforeEach(() => {
    process.env.EXECUTION_OS_IDENTITY_MODE = 'HOS';
    process.env.HOS_EXECUTION_SHARED_SECRET = 'test-hos-execution-shared-secret-at-least-32-chars';
    factory = new TestSubjectRepositoryFactory();
    transport = new MemoryHOSEventMeshTransport();
    boundaryStore = new MemoryHOSBoundaryStore();
    bridge = new HOSEventMeshBridge(transport, new MemoryDeadLetterQueue(), 1, boundaryStore);
    lifecycle = new HOSEngineLifecycleRegistry(boundaryStore);
    app = createApp({
      hosRepositoryFactory: factory,
      hosEventMesh: bridge,
      hosLifecycle: lifecycle,
      hosBoundaryStore: boundaryStore,
    });
  });

  afterEach(() => {
    process.env.EXECUTION_OS_IDENTITY_MODE = 'LEGACY_STANDALONE';
  });

  it('E5: publishes a formal engine manifest with exactly the six canonical E6 capabilities', async () => {
    const res = await request(app).get('/api/v1/hos/manifest');
    expect(res.status).toBe(200);
    expect(res.body.data.identityAuthority).toBe('HumanKernelOS');
    expect(res.body.data.scheduleAuthority).toBe('HumanKernelOS');
    expect(res.body.data.capabilities.map((c: any) => c.name)).toEqual([
      'schedule.get',
      'session.start',
      'session.advance',
      'session.close',
      'fallback.trigger',
      'discipline.score.get',
    ]);
  });

  it('E4: rejects unsigned HOS calls and binds a valid signed HOS assertion to the execution subject', async () => {
    const unsigned = await request(app).get('/api/v1/hos/whoami');
    expect(unsigned.status).toBe(401);
    expect(unsigned.body.code).toBe('AUTHENTICATION_REQUIRED');

    const assertion = assertionFor('hos-user-alpha');
    const signed = await request(app)
      .get('/api/v1/hos/whoami')
      .set(headersFor(assertion));

    expect(signed.status).toBe(200);
    expect(signed.body.data.subjectId).toBe('hos-user-alpha');
    expect(signed.body.data.issuer).toBe('HumanKernelOS');
    expect(signed.body.data.tenantId).toBe('tenant-hos');
  });

  it('E4: normal HOS subjects cannot bypass the engine adapter through legacy HEE routes', async () => {
    const assertion = assertionFor('hos-user-alpha');
    const res = await request(app)
      .get('/api/v1/hee/execution/now')
      .set(headersFor(assertion));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('AUTHORIZATION_FAILED');
    expect(res.body.message).toMatch(/capability contract/i);
  });

  it('E4: production repository factory isolates canonical state by HOS tenant and subject', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'execution-os-hos-e4-'));
    try {
      const productionFactory = new HOSSubjectScopedRepositoryFactory(tempDir);
      const aAssertion = assertionFor('subject-a', ALL_PERMISSIONS, ALL_CONSENT, 'tenant-a');
      const bAssertion = assertionFor('subject-b', ALL_PERMISSIONS, ALL_CONSENT, 'tenant-a');
      const a = contextFor(aAssertion);
      const b = contextFor(bAssertion);

      const repoA = productionFactory.forSubject(a);
      const stateA = await repoA.loadState();
      stateA.subjectId = a.subjectId;
      stateA.tenantId = a.tenantId;
      stateA.rewardPoints = 37;
      await repoA.saveState(stateA);

      const repoB = productionFactory.forSubject(b);
      const stateB = await repoB.loadState();
      expect(stateB.rewardPoints).not.toBe(37);
      expect(stateB.subjectId).not.toBe(a.subjectId);

      stateB.subjectId = b.subjectId;
      stateB.tenantId = b.tenantId;
      await repoB.saveState(stateB);

      const reloadedA = await repoA.loadState();
      expect(reloadedA.rewardPoints).toBe(37);
      expect(fs.readdirSync(tempDir).filter(name => name.endsWith('.json')).length).toBeGreaterThanOrEqual(2);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('E4: Execution OS cannot mint standalone identity tokens while HOS is authoritative', async () => {
    const assertion = assertionFor('hos-user-alpha', [...ALL_PERMISSIONS, 'execution.legacy.api']);
    const res = await request(app)
      .post('/api/v1/hee/auth/token')
      .set(headersFor(assertion))
      .send({ userId: 'attempted-local-user' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SECURITY_INTEGRITY_VIOLATION');
    expect(res.body.message).toMatch(/does not mint identity tokens/i);
  });

  it('E4/E5: isolates repositories by HOS subject and applies Daily Operating Plan signals idempotently', async () => {
    const a = assertionFor('hos-user-a');
    const b = assertionFor('hos-user-b');

    const plan = {
      planId: 'dop-a-1',
      planVersion: '1',
      subjectId: 'hos-user-a',
      localDate: '2026-10-31',
      timezone: 'Africa/Nairobi',
      source: 'HOS',
      receivedAtUtc: new Date().toISOString(),
      executionActivities: [],
      commitments: [],
      delegatedWindows: [],
    };

    const first = await request(app)
      .post('/api/v1/hos/signals')
      .set(headersFor(a))
      .set('Idempotency-Key', 'signal-plan-a-1')
      .send({ type: 'hos.daily_operating_plan.updated', data: { plan } });
    expect(first.status).toBe(200);
    expect(first.body.data.scheduleAuthority.authoritativePlan.planId).toBe('dop-a-1');

    const replay = await request(app)
      .post('/api/v1/hos/signals')
      .set(headersFor(a))
      .set('Idempotency-Key', 'signal-plan-a-1')
      .send({ type: 'hos.daily_operating_plan.updated', data: { plan } });
    expect(replay.status).toBe(200);
    expect(replay.headers['x-idempotent-replay']).toBe('true');

    const scheduleA = await request(app)
      .post('/api/v1/hos/capabilities/schedule.get')
      .set(headersFor(a))
      .send({});
    const scheduleB = await request(app)
      .post('/api/v1/hos/capabilities/schedule.get')
      .set(headersFor(b))
      .send({});

    expect(scheduleA.status).toBe(200);
    expect(scheduleA.body.data.data.plan.planId).toBe('dop-a-1');
    expect(scheduleB.status).toBe(200);
    expect(scheduleB.body.data.data.plan).toBeNull();
  });

  it('E5: capability permissions and consent are both enforced by the HOS adapter', async () => {
    const noPermission = assertionFor(
      'hos-no-permission',
      ALL_PERMISSIONS.filter(permission => permission !== 'execution.schedule.read'),
      ALL_CONSENT
    );
    const deniedPermission = await request(app)
      .post('/api/v1/hos/capabilities/schedule.get')
      .set(headersFor(noPermission))
      .send({});
    expect(deniedPermission.status).toBe(403);
    expect(deniedPermission.body.code).toBe('AUTHORIZATION_FAILED');

    const noConsent = assertionFor(
      'hos-no-consent',
      ALL_PERMISSIONS,
      ALL_CONSENT.filter(scope => scope !== 'execution.analytics')
    );
    const deniedConsent = await request(app)
      .post('/api/v1/hos/capabilities/discipline.score.get')
      .set(headersFor(noConsent))
      .send({});
    expect(deniedConsent.status).toBe(403);
    expect(deniedConsent.body.code).toBe('AUTHORIZATION_FAILED');
  });

  it('E5: lifecycle pause blocks execution capabilities until HOS resumes the engine', async () => {
    const assertion = assertionFor('hos-user-alpha');
    const headers = headersFor(assertion);

    const pause = await request(app)
      .post('/api/v1/hos/lifecycle')
      .set(headers)
      .send({ action: 'PAUSE', reason: 'HOS maintenance window' });
    expect(pause.status).toBe(200);
    expect(pause.body.data.state).toBe('PAUSED');

    const blocked = await request(app)
      .post('/api/v1/hos/capabilities/schedule.get')
      .set(headers)
      .send({});
    expect(blocked.status).toBe(400);
    expect(blocked.body.message).toMatch(/PAUSED/);

    const resume = await request(app)
      .post('/api/v1/hos/lifecycle')
      .set(headers)
      .send({ action: 'RESUME' });
    expect(resume.status).toBe(200);

    const allowed = await request(app)
      .post('/api/v1/hos/capabilities/schedule.get')
      .set(headers)
      .send({});
    expect(allowed.status).toBe(200);
  });

  it('E6: session.start is idempotent and emits a single HOS session-start event', async () => {
    const assertion = assertionFor('hos-session-user');
    const subject = contextFor(assertion);
    const state = JSON.parse(JSON.stringify(LEGACY_STANDALONE_FIXTURE_STATE));
    state.scheduleAuthority = undefined;
    await factory.seed(subject, state);

    const first = await request(app)
      .post('/api/v1/hos/capabilities/session.start')
      .set(headersFor(assertion))
      .set('Idempotency-Key', 'start-session-1')
      .send({ activityInstanceId: 'task-deep-work-build', environmentType: 'INTEGRATED' });

    expect(first.status).toBe(200);
    const sessionId = first.body.data.data.sessionId;
    expect(sessionId).toBeDefined();
    expect(first.body.data.data.session.status).toBe('ACTIVE');

    const replay = await request(app)
      .post('/api/v1/hos/capabilities/session.start')
      .set(headersFor(assertion))
      .set('Idempotency-Key', 'start-session-1')
      .send({ activityInstanceId: 'task-deep-work-build', environmentType: 'INTEGRATED' });

    expect(replay.status).toBe(200);
    expect(replay.headers['x-idempotent-replay']).toBe('true');
    expect(replay.body.data.data.sessionId).toBe(sessionId);
    expect(transport.published.filter(e => e.type === 'execution.session.started')).toHaveLength(1);

    const advance = await request(app)
      .post('/api/v1/hos/capabilities/session.advance')
      .set(headersFor(assertion))
      .set('Idempotency-Key', 'advance-session-1')
      .send({ sessionId, stepIndex: 0, notes: 'HOS integration certification' });
    expect(advance.status).toBe(200);

    const close = await request(app)
      .post('/api/v1/hos/capabilities/session.close')
      .set(headersFor(assertion))
      .set('Idempotency-Key', 'close-session-1')
      .send({ sessionId, outcome: 'PARTIAL', reason: 'Certification close' });
    expect(close.status).toBe(200);
  });

  it('E6: fallback.trigger and discipline.score.get execute through capability governance', async () => {
    const assertion = assertionFor('hos-fallback-user');
    const subject = contextFor(assertion);
    const state = JSON.parse(JSON.stringify(LEGACY_STANDALONE_FIXTURE_STATE));
    await factory.seed(subject, state);

    const fallback = await request(app)
      .post('/api/v1/hos/capabilities/fallback.trigger')
      .set(headersFor(assertion))
      .set('Idempotency-Key', 'fallback-1')
      .send({ taskId: 'task-meditation', targetTierLevel: 1, reason: 'Certification constraint' });
    expect(fallback.status).toBe(200);

    const discipline = await request(app)
      .post('/api/v1/hos/capabilities/discipline.score.get')
      .set(headersFor(assertion))
      .send({});
    expect(discipline.status).toBe(200);
    expect(discipline.body.data.data.score).toBeGreaterThanOrEqual(0);
    expect(discipline.body.data.data.score).toBeLessThanOrEqual(100);
    expect(discipline.body.data.data.evidence).toBeDefined();
  });

  it('E6: discipline score refuses to manufacture performance when no execution evidence exists', async () => {
    const assertion = assertionFor('hos-empty-score-user');
    const res = await request(app)
      .post('/api/v1/hos/capabilities/discipline.score.get')
      .set(headersFor(assertion))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.data.score).toBe(0);
    expect(res.body.data.data.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(res.body.data.data.evidence.committedActivities).toBe(0);
  });

  it('E6: session and fallback capabilities cannot execute activities outside the active HOS delegation', async () => {
    const assertion = assertionFor('hos-delegation-user');
    const subject = contextFor(assertion);
    const state = JSON.parse(JSON.stringify(LEGACY_STANDALONE_FIXTURE_STATE));
    state.subjectId = subject.subjectId;
    state.tenantId = subject.tenantId;
    state.scheduleAuthority = {
      mode: 'HOS',
      authoritativePlan: {
        planId: 'dop-delegation',
        planVersion: '1',
        subjectId: subject.subjectId,
        localDate: '2026-10-31',
        timezone: 'Africa/Nairobi',
        source: 'HOS',
        receivedAtUtc: new Date().toISOString(),
        executionActivities: state.tasks.filter((task: any) => task.id === 'task-meditation'),
        commitments: [],
        delegatedWindows: [{
          id: 'delegated-meditation',
          startMinutes: 0,
          endMinutes: 1440,
          allowedActivityIds: ['task-meditation'],
          canReallocate: true,
          canCompress: true,
          canDefer: true,
        }],
      },
      lastAcceptedPlanId: 'dop-delegation',
      lastAcceptedPlanVersion: '1',
    };
    await factory.seed(subject, state);

    const denied = await request(app)
      .post('/api/v1/hos/capabilities/session.start')
      .set(headersFor(assertion))
      .set('Idempotency-Key', 'outside-delegation-1')
      .send({ activityInstanceId: 'task-deep-work-build' });

    expect(denied.status).toBe(400);
    expect(denied.body.message).toMatch(/not delegated by HOS plan/i);
  });

  it('E6: Event Mesh retries a transient delivery failure and succeeds without dead-lettering', async () => {
    class FlakyTransport implements IHOSEventMeshTransport {
      attempts = 0;
      published: any[] = [];
      async publish(event: any): Promise<void> {
        this.attempts += 1;
        if (this.attempts === 1) throw new Error('transient mesh fault');
        this.published.push(event);
      }
    }

    const flaky = new FlakyTransport();
    const dlq = new MemoryDeadLetterQueue();
    const retryBridge = new HOSEventMeshBridge(flaky, dlq, 2);
    const assertion = assertionFor('hos-retry-user');
    const subject = contextFor(assertion);
    const event: SystemEvent = {
      event_id: 'evt-retry-1',
      event_type: 'ActivityStarted',
      event_version: '1.0.0',
      occurred_at: new Date().toISOString(),
      actor: 'SYSTEM_KERNEL',
      subject: 'activity-1',
      scope: 'EXECUTION',
      payload: { taskId: 'activity-1' },
      metadata: { currentMinutes: 0, mode: 'GREEN', routineState: 'STANDARD' },
    };

    const result = await retryBridge.publish(event, subject);
    expect(result?.status).toBe('DELIVERED');
    expect(result?.attempts).toBe(2);
    expect(flaky.published).toHaveLength(1);
    expect(await retryBridge.listDeadLetters(subject)).toHaveLength(0);
  });

  it('E6: Event Mesh delivery deduplicates repeated events', async () => {
    const assertion = assertionFor('hos-event-user');
    const subject = contextFor(assertion);
    const event: SystemEvent = {
      event_id: 'evt-dedupe-1',
      event_type: 'ActivityStarted',
      event_version: '1.0.0',
      occurred_at: new Date().toISOString(),
      actor: 'SYSTEM_KERNEL',
      subject: 'activity-1',
      scope: 'EXECUTION',
      payload: { taskId: 'activity-1' },
      metadata: { currentMinutes: 0, mode: 'GREEN', routineState: 'STANDARD' },
    };

    const first = await bridge.publish(event, subject);
    const second = await bridge.publish(event, subject);

    expect(first?.status).toBe('DELIVERED');
    expect(second?.status).toBe('SKIPPED_DUPLICATE');
    expect(transport.published).toHaveLength(1);
  });

  it('E6: exhausted Event Mesh retries are dead-lettered and auditable', async () => {
    class FailingTransport implements IHOSEventMeshTransport {
      attempts = 0;
      async publish(): Promise<void> {
        this.attempts += 1;
        throw new Error('simulated mesh outage');
      }
    }

    const failing = new FailingTransport();
    const dlq = new MemoryDeadLetterQueue();
    const failingBridge = new HOSEventMeshBridge(failing, dlq, 1);
    const assertion = assertionFor('hos-event-user');
    const subject = contextFor(assertion);
    const event: SystemEvent = {
      event_id: 'evt-fail-1',
      event_type: 'ActivityCompleted',
      event_version: '1.0.0',
      occurred_at: new Date().toISOString(),
      actor: 'SYSTEM_KERNEL',
      subject: 'activity-1',
      scope: 'EXECUTION',
      payload: { taskId: 'activity-1' },
      metadata: { currentMinutes: 0, mode: 'GREEN', routineState: 'STANDARD' },
    };

    const result = await failingBridge.publish(event, subject);
    expect(result?.status).toBe('FAILED_DEAD_LETTERED');
    expect(failing.attempts).toBe(2);
    expect((await failingBridge.listDeadLetters(subject))).toHaveLength(1);
    expect(failingBridge.listAudit(subject)[0].error).toContain('simulated mesh outage');
  });
  it('E4-E6: boundary identity, lifecycle, idempotency and Event Mesh audit survive process restart', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'execution-os-hos-boundary-'));
    const boundaryPath = path.join(tempDir, 'hos-boundary.json');
    const dlqPath = path.join(tempDir, 'hos-dlq.json');
    const subjectData = path.join(tempDir, 'subjects');

    try {
      const assertion = assertionFor('hos-restart-user');
      const headers = headersFor(assertion);
      const subject = contextFor(assertion);

      const store1 = new FileHOSBoundaryStore(boundaryPath);
      const dlq1 = new FileDeadLetterQueue(dlqPath);
      const transport1 = new MemoryHOSEventMeshTransport();
      const bridge1 = new HOSEventMeshBridge(transport1, dlq1, 1, store1);
      const lifecycle1 = new HOSEngineLifecycleRegistry(store1);
      const repos1 = new HOSSubjectScopedRepositoryFactory(subjectData);

      const seeded = JSON.parse(JSON.stringify(LEGACY_STANDALONE_FIXTURE_STATE));
      seeded.subjectId = subject.subjectId;
      seeded.tenantId = subject.tenantId;
      await repos1.forSubject(subject).saveState(seeded);

      const app1 = createApp({
        hosRepositoryFactory: repos1,
        hosEventMesh: bridge1,
        hosLifecycle: lifecycle1,
        hosBoundaryStore: store1,
      });

      const pause = await request(app1)
        .post('/api/v1/hos/lifecycle')
        .set(headers)
        .send({ action: 'PAUSE', reason: 'restart certification' });
      expect(pause.status).toBe(200);

      const resume = await request(app1)
        .post('/api/v1/hos/lifecycle')
        .set(headers)
        .send({ action: 'RESUME' });
      expect(resume.status).toBe(200);

      const first = await request(app1)
        .post('/api/v1/hos/capabilities/session.start')
        .set(headers)
        .set('Idempotency-Key', 'restart-session-start')
        .send({ activityInstanceId: 'task-deep-work-build', environmentType: 'INTEGRATED' });
      expect(first.status).toBe(200);
      expect(transport1.published.filter(e => e.type === 'execution.session.started')).toHaveLength(1);

      lifecycle1.set(subject, 'PAUSED', 'persist across restart');

      // Simulated process restart: all adapter objects are recreated from disk.
      const store2 = new FileHOSBoundaryStore(boundaryPath);
      const dlq2 = new FileDeadLetterQueue(dlqPath);
      const transport2 = new MemoryHOSEventMeshTransport();
      const bridge2 = new HOSEventMeshBridge(transport2, dlq2, 1, store2);
      const lifecycle2 = new HOSEngineLifecycleRegistry(store2);
      const repos2 = new HOSSubjectScopedRepositoryFactory(subjectData);
      const app2 = createApp({
        hosRepositoryFactory: repos2,
        hosEventMesh: bridge2,
        hosLifecycle: lifecycle2,
        hosBoundaryStore: store2,
      });

      const lifecycleAfterRestart = await request(app2)
        .get('/api/v1/hos/lifecycle')
        .set(headers);
      expect(lifecycleAfterRestart.status).toBe(200);
      expect(lifecycleAfterRestart.body.data.state).toBe('PAUSED');

      lifecycle2.set(subject, 'ACTIVE', 'resume certification');

      const replay = await request(app2)
        .post('/api/v1/hos/capabilities/session.start')
        .set(headers)
        .set('Idempotency-Key', 'restart-session-start')
        .send({ activityInstanceId: 'task-deep-work-build', environmentType: 'INTEGRATED' });
      expect(replay.status).toBe(200);
      expect(replay.headers['x-idempotent-replay']).toBe('true');
      expect(transport2.published).toHaveLength(0);

      const event: SystemEvent = {
        event_id: 'evt-restart-dedupe',
        event_type: 'ActivityStarted',
        event_version: '1.0.0',
        occurred_at: new Date().toISOString(),
        actor: 'SYSTEM_KERNEL',
        subject: 'task-deep-work-build',
        scope: 'EXECUTION',
        payload: { taskId: 'task-deep-work-build' },
        metadata: { currentMinutes: 0, mode: 'GREEN', routineState: 'STANDARD' },
      };
      const delivered = await bridge2.publish(event, subject);
      expect(delivered?.status).toBe('DELIVERED');

      const store3 = new FileHOSBoundaryStore(boundaryPath);
      const bridge3 = new HOSEventMeshBridge(new MemoryHOSEventMeshTransport(), new FileDeadLetterQueue(dlqPath), 1, store3);
      const duplicate = await bridge3.publish(event, subject);
      expect(duplicate?.status).toBe('SKIPPED_DUPLICATE');
      expect(bridge3.listAudit(subject).some(row => row.eventId === 'evt-restart-dedupe')).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

});
