import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/createApp';
import { HOSIdentityAssertion, HOSIdentityBridge, HOSSubjectContext } from '../hos/identityBridge';
import { IHOSRepositoryFactory, StaticHOSRepositoryFactory } from '../hos/repositoryFactory';
import { IExecutionRepository } from '../repositories';
import { InMemoryExecutionRepository } from '../repositories/implementations';
import { MemoryHOSEventMeshTransport, HOSEventMeshBridge } from '../hos/eventMesh';
import { MemoryDeadLetterQueue } from '../services/deadLetterQueue';
import { HOSEngineLifecycleRegistry } from '../hos/lifecycle';
import { MemoryHOSBoundaryStore } from '../hos/boundaryStore';
import { createEmptyExecutionState } from '../data/defaultData';
import { LEGACY_STANDALONE_FIXTURE_STATE } from './fixtures/legacyStandaloneProfile';
import {
  acceptHOSHumanStateContext,
  acceptPDIEExecutionRecommendation,
  getHumanStateExecutionFitModifier,
} from '../hos/humanStateDecisionBridge';
import { calculateDynamicAllocations } from '../services/allocationEngine';
import { getAutonomousNextDecision } from '../services/decisionEngine';

class SubjectFactory implements IHOSRepositoryFactory {
  private repos = new Map<string, IExecutionRepository>();
  private key(subject: HOSSubjectContext) { return `${subject.tenantId}::${subject.subjectId}`; }

  forSubject(subject: HOSSubjectContext): IExecutionRepository {
    const key = this.key(subject);
    if (!this.repos.has(key)) this.repos.set(key, new InMemoryExecutionRepository(createEmptyExecutionState()));
    return this.repos.get(key)!;
  }

  async seed(subject: HOSSubjectContext, state: any) {
    await this.forSubject(subject).saveState(JSON.parse(JSON.stringify(state)));
  }
}

const PERMISSIONS = [
  'execution.schedule.read',
  'execution.schedule.write',
  'execution.session.write',
  'execution.fallback.write',
  'execution.discipline.read',
  'execution.lifecycle.manage',
  'execution.gate.write',
  'execution.events.read',
  'execution.events.manage',
  'execution.context.write',
  'execution.adaptation.recommend',
];

const CONSENT = [
  'execution.schedule',
  'execution.performance',
  'execution.adaptation',
  'execution.analytics',
  'execution.control',
  'execution.audit',
  'execution.human_state',
];

function assertionFor(subjectId = 'hos-e7-user'): HOSIdentityAssertion {
  return {
    subjectId,
    tenantId: 'tenant-e7',
    permissions: PERMISSIONS,
    consentScopes: CONSENT,
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

function contextFor(assertion: HOSIdentityAssertion) {
  return HOSIdentityBridge.verifyAssertion(assertion, HOSIdentityBridge.signAssertion(assertion));
}

describe('HumanKernelOS E7 — Human State & Decision Bridge', () => {
  let factory: SubjectFactory;
  let transport: MemoryHOSEventMeshTransport;
  let boundary: MemoryHOSBoundaryStore;
  let bridge: HOSEventMeshBridge;
  let lifecycle: HOSEngineLifecycleRegistry;
  let app: any;

  beforeEach(() => {
    process.env.EXECUTION_OS_IDENTITY_MODE = 'HOS';
    process.env.HOS_EXECUTION_SHARED_SECRET = 'e7-hos-execution-shared-secret-at-least-32-characters';
    factory = new SubjectFactory();
    transport = new MemoryHOSEventMeshTransport();
    boundary = new MemoryHOSBoundaryStore();
    bridge = new HOSEventMeshBridge(transport, new MemoryDeadLetterQueue(), 1, boundary);
    lifecycle = new HOSEngineLifecycleRegistry(boundary);
    app = createApp({
      hosRepositoryFactory: factory,
      hosEventMesh: bridge,
      hosLifecycle: lifecycle,
      hosBoundaryStore: boundary,
    });
  });

  afterEach(() => {
    process.env.EXECUTION_OS_IDENTITY_MODE = 'LEGACY_STANDALONE';
  });

  it('publishes the E7 Human State / PDIE / behavioral-signal contract in the engine manifest', async () => {
    const res = await request(app).get('/api/v1/hos/manifest');
    expect(res.status).toBe(200);
    expect(Number(String(res.body.data.engineVersion).replace(/^E/, ''))).toBeGreaterThanOrEqual(7);
    expect(res.body.data.consumesSignals).toContain('hos.human_state.updated');
    expect(res.body.data.consumesSignals).toContain('hos.pdie.recommendation.created');
    expect(res.body.data.publishesEvents).toContain('execution.behavior.signal');
  });

  it('accepts only a minimum-necessary HOS Human State execution projection with subject provenance', async () => {
    const assertion = assertionFor();
    const context = {
      contextId: 'hs-e7-1',
      subjectId: assertion.subjectId,
      source: 'HumanKernelOS',
      sourceRef: 'hsv-projection-42',
      schemaVersion: '1.0',
      observedAtUtc: new Date().toISOString(),
      validUntilUtc: new Date(Date.now() + 60_000).toISOString(),
      confidence: 0.91,
      energyCapacity: 42,
      cognitiveCapacity: 35,
      physicalCapacity: 70,
      recoveryNeed: 82,
      stressLoad: 66,
      attentionStability: 38,
      availability: 'LIMITED',
      executionConstraints: ['SHORT_FOCUS_ONLY'],
    };

    const res = await request(app)
      .post('/api/v1/hos/signals')
      .set(headersFor(assertion))
      .set('Idempotency-Key', 'human-state-e7-1')
      .send({ type: 'hos.human_state.updated', data: { context } });

    expect(res.status).toBe(200);
    expect(res.body.data.humanStateContext.contextId).toBe('hs-e7-1');
    expect(res.body.data.humanStateContext.source).toBe('HumanKernelOS');
    expect(res.body.data.humanStateContext.cognitiveCapacity).toBe(35);

    const saved = await factory.forSubject(contextFor(assertion)).loadState();
    expect(saved.hosHumanStateContext?.sourceRef).toBe('hsv-projection-42');
    expect((saved.hosHumanStateContext as any)?.hsv).toBeUndefined();
    expect((saved.hosHumanStateContext as any)?.personalPolicy).toBeUndefined();
  });

  it('rejects cross-subject Human State and direct HSV / Personal Policy mutation attempts', async () => {
    const assertion = assertionFor();

    const wrongSubject = await request(app)
      .post('/api/v1/hos/signals')
      .set(headersFor(assertion))
      .set('Idempotency-Key', 'human-state-wrong-subject')
      .send({
        type: 'hos.human_state.updated',
        data: {
          context: {
            contextId: 'hs-wrong',
            subjectId: 'another-subject',
            source: 'HumanKernelOS',
            sourceRef: 'hsv-1',
            schemaVersion: '1.0',
            observedAtUtc: new Date().toISOString(),
            confidence: 1,
          },
        },
      });
    expect(wrongSubject.status).toBe(400);

    const hsvMutation = await request(app)
      .post('/api/v1/hos/signals')
      .set(headersFor(assertion))
      .set('Idempotency-Key', 'human-state-hsv-write')
      .send({
        type: 'hos.human_state.updated',
        data: {
          context: {
            contextId: 'hs-hsv',
            subjectId: assertion.subjectId,
            source: 'HumanKernelOS',
            sourceRef: 'hsv-2',
            schemaVersion: '1.0',
            observedAtUtc: new Date().toISOString(),
            confidence: 1,
            hsv: { mood: 'overwrite-attempt' },
          },
        },
      });
    expect(hsvMutation.status).toBe(400);
    expect(hsvMutation.body.message).toMatch(/HSV|Personal Policy/i);

    const policyMutation = await request(app)
      .post('/api/v1/hos/signals')
      .set(headersFor(assertion))
      .set('Idempotency-Key', 'policy-write-attempt')
      .send({ type: 'hos.personal_policy.updated', data: { policy: { priority: 'replace' } } });
    expect(policyMutation.status).toBe(400);
  });

  it('projects a PDIE recommendation into bounded execution adaptation without mutating schedule or Personal Policy', async () => {
    const assertion = assertionFor();
    const subject = contextFor(assertion);
    const state = JSON.parse(JSON.stringify(LEGACY_STANDALONE_FIXTURE_STATE));
    delete state.legacyStandaloneCompatibility;
    state.subjectId = subject.subjectId;
    state.tenantId = subject.tenantId;
    state.scheduleAuthority = undefined;
    await factory.seed(subject, state);

    const originalTask = state.tasks.find((task: any) => task.id === 'task-deep-work-build');
    const originalStart = originalTask.startMinutes;
    const originalEnd = originalTask.endMinutes;

    const recommendation = {
      id: 'pdie-rec-e7-1',
      subjectId: subject.subjectId,
      source: 'PDIE',
      recommendationVersion: '1',
      type: 'PREFER_LOWER_COGNITIVE_LOAD',
      confidence: 0.9,
      rationale: 'Recent execution evidence suggests lower cognitive loading is more sustainable.',
      evidenceRefs: ['pdie-evidence-1'],
      issuedAtUtc: new Date().toISOString(),
      expiresAtUtc: new Date(Date.now() + 60_000).toISOString(),
      parameters: { strength: 1 },
      status: 'RECEIVED',
    };

    const res = await request(app)
      .post('/api/v1/hos/signals')
      .set(headersFor(assertion))
      .set('Idempotency-Key', 'pdie-e7-1')
      .send({ type: 'hos.pdie.recommendation.created', data: { recommendation } });

    expect(res.status).toBe(200);
    const saved = await factory.forSubject(subject).loadState();
    expect(saved.pdieExecutionRecommendations?.[0].status).toBe('ACTIVE_ADVISORY');
    expect(saved.tasks.find(task => task.id === 'task-deep-work-build')?.startMinutes).toBe(originalStart);
    expect(saved.tasks.find(task => task.id === 'task-deep-work-build')?.endMinutes).toBe(originalEnd);
    expect((saved as any).personalPolicy).toBeUndefined();

    const deepWork = saved.tasks.find(task => task.id === 'task-deep-work-build')!;
    expect(getHumanStateExecutionFitModifier(saved, deepWork)).toBeLessThan(0);
  });

  it('uses fresh Human State/PDIE as soft decision evidence, never as schedule authority', () => {
    let state = JSON.parse(JSON.stringify(LEGACY_STANDALONE_FIXTURE_STATE));
    delete state.legacyStandaloneCompatibility;
    state.subjectId = 'hos-e7-user';
    state.isSimulatedTime = true;
    state.simulatedTime = '08:00';

    state = acceptHOSHumanStateContext(state, {
      contextId: 'hs-fit',
      subjectId: 'hos-e7-user',
      source: 'HumanKernelOS',
      sourceRef: 'hsv-fit',
      schemaVersion: '1.0',
      observedAtUtc: new Date().toISOString(),
      validUntilUtc: new Date(Date.now() + 60_000).toISOString(),
      confidence: 0.9,
      cognitiveCapacity: 25,
      recoveryNeed: 85,
      attentionStability: 30,
      availability: 'LIMITED',
    });

    state = acceptPDIEExecutionRecommendation(state, {
      id: 'pdie-fit',
      subjectId: 'hos-e7-user',
      source: 'PDIE',
      recommendationVersion: '1',
      type: 'PREFER_RECOVERY',
      confidence: 0.9,
      rationale: 'Prefer recovery under current Human State.',
      evidenceRefs: ['ev-1'],
      issuedAtUtc: new Date().toISOString(),
      expiresAtUtc: new Date(Date.now() + 60_000).toISOString(),
      status: 'RECEIVED',
    });

    const before = state.tasks.map((task: any) => ({ id: task.id, start: task.startMinutes, end: task.endMinutes }));
    const allocations = calculateDynamicAllocations(state);
    const decision = getAutonomousNextDecision(state);

    expect(allocations.allocations.some(a => /Human State\/PDIE fit/.test(a.reasonForAdjustment || ''))).toBe(true);
    expect(decision.decisionReason).toMatch(/HOS Human State|PDIE/i);
    for (const original of before) {
      const task = state.tasks.find((item: any) => item.id === original.id)!;
      expect(task.startMinutes).toBe(original.start);
      expect(task.endMinutes).toBe(original.end);
    }
  });

  it('ignores expired Human State and PDIE recommendations when scoring execution fit', () => {
    let state = JSON.parse(JSON.stringify(LEGACY_STANDALONE_FIXTURE_STATE));
    delete state.legacyStandaloneCompatibility;
    state.subjectId = 'hos-e7-user';

    state = acceptHOSHumanStateContext(state, {
      contextId: 'expired-hs',
      subjectId: 'hos-e7-user',
      source: 'HumanKernelOS',
      sourceRef: 'expired',
      schemaVersion: '1.0',
      observedAtUtc: new Date(Date.now() - 120_000).toISOString(),
      validUntilUtc: new Date(Date.now() - 60_000).toISOString(),
      confidence: 1,
      cognitiveCapacity: 0,
    });
    state = acceptPDIEExecutionRecommendation(state, {
      id: 'expired-pdie',
      subjectId: 'hos-e7-user',
      source: 'PDIE',
      recommendationVersion: '1',
      type: 'PREFER_LOWER_COGNITIVE_LOAD',
      confidence: 1,
      rationale: 'Expired',
      evidenceRefs: [],
      issuedAtUtc: new Date(Date.now() - 120_000).toISOString(),
      expiresAtUtc: new Date(Date.now() - 60_000).toISOString(),
      status: 'RECEIVED',
    });

    const task = state.tasks.find((item: any) => item.id === 'task-deep-work-build')!;
    expect(getHumanStateExecutionFitModifier(state, task)).toBe(0);
  });

  it('publishes execution behavioral evidence to HOS alongside operational Event Mesh events', async () => {
    const assertion = assertionFor();
    const subject = contextFor(assertion);
    const state = JSON.parse(JSON.stringify(LEGACY_STANDALONE_FIXTURE_STATE));
    state.subjectId = subject.subjectId;
    state.tenantId = subject.tenantId;
    await factory.seed(subject, state);

    const res = await request(app)
      .post('/api/v1/hos/capabilities/fallback.trigger')
      .set(headersFor(assertion))
      .set('Idempotency-Key', 'fallback-e7-behavior')
      .send({ taskId: 'task-meditation', targetTierLevel: 1, reason: 'E7 behavioral signal certification' });

    expect(res.status).toBe(200);
    expect(transport.published.some(event => event.type === 'execution.fallback.triggered')).toBe(true);
    const behavior = transport.published.find(event =>
      event.type === 'execution.behavior.signal' &&
      event.data.signalType === 'RECOVERY_BEHAVIOR'
    );
    expect(behavior).toBeDefined();
    expect(behavior?.data.provenance.source).toBe('ExecutionOS');

    const saved = await factory.forSubject(subject).loadState();
    expect(saved.executionBehavioralSignals?.some(signal => signal.type === 'RECOVERY_BEHAVIOR')).toBe(true);
  });

  it('keeps behavioral signals minimum-necessary and does not claim Human State or policy truth', async () => {
    const assertion = assertionFor();
    const subject = contextFor(assertion);
    const state = JSON.parse(JSON.stringify(LEGACY_STANDALONE_FIXTURE_STATE));
    state.subjectId = subject.subjectId;
    state.tenantId = subject.tenantId;
    await factory.seed(subject, state);

    await request(app)
      .post('/api/v1/hos/capabilities/fallback.trigger')
      .set(headersFor(assertion))
      .set('Idempotency-Key', 'fallback-e7-minimum')
      .send({ taskId: 'task-meditation', targetTierLevel: 1, reason: 'Minimum necessary evidence' });

    const behavior = transport.published.find(event => event.type === 'execution.behavior.signal');
    expect(behavior).toBeDefined();
    expect(behavior?.data).not.toHaveProperty('hsv');
    expect(behavior?.data).not.toHaveProperty('personalPolicy');
    expect(JSON.stringify(behavior?.data || {})).not.toMatch(/diagnosis|moodTruth|personalPolicy/i);
  });
});
