import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/createApp';
import { HOSIdentityAssertion, HOSIdentityBridge, HOSSubjectContext } from '../hos/identityBridge';
import { IHOSRepositoryFactory } from '../hos/repositoryFactory';
import { IExecutionRepository } from '../repositories';
import { InMemoryExecutionRepository } from '../repositories/implementations';
import { createEmptyExecutionState } from '../data/defaultData';
import { MemoryHOSBoundaryStore } from '../hos/boundaryStore';
import { HOSEngineLifecycleRegistry } from '../hos/lifecycle';
import { HOSEventMeshBridge, MemoryHOSEventMeshTransport } from '../hos/eventMesh';
import { MemoryDeadLetterQueue } from '../services/deadLetterQueue';

class SubjectFactory implements IHOSRepositoryFactory {
  private repos = new Map<string, IExecutionRepository>();

  private key(subject: HOSSubjectContext) {
    return `${subject.tenantId}::${subject.subjectId}`;
  }

  forSubject(subject: HOSSubjectContext): IExecutionRepository {
    const key = this.key(subject);
    let repo = this.repos.get(key);
    if (!repo) {
      repo = new InMemoryExecutionRepository(createEmptyExecutionState());
      this.repos.set(key, repo);
    }
    return repo;
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
  'execution.governance.write',
  'execution.lifecycle.manage',
];

const CONSENTS = [
  'execution.schedule',
  'execution.performance',
  'execution.adaptation',
  'execution.analytics',
  'execution.control',
];

function assertionFor(subjectId: string, tenantId = 'tenant-e11'): HOSIdentityAssertion {
  return {
    subjectId,
    tenantId,
    permissions: [...PERMISSIONS],
    consentScopes: [...CONSENTS],
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

describe('HOS E11 — Authoritative Client Runtime & Workflow Unification', () => {
  let factory: SubjectFactory;
  let boundary: MemoryHOSBoundaryStore;
  let app: any;

  beforeEach(() => {
    process.env.EXECUTION_OS_IDENTITY_MODE = 'HOS';
    process.env.HOS_EXECUTION_SHARED_SECRET = 'e11-hos-shared-secret-at-least-thirty-two-characters';
    process.env.HEE_SECURITY_SECRET = 'e11-client-session-secret-at-least-thirty-two-characters';

    factory = new SubjectFactory();
    boundary = new MemoryHOSBoundaryStore();
    const eventMesh = new HOSEventMeshBridge(
      new MemoryHOSEventMeshTransport(),
      new MemoryDeadLetterQueue(),
      1,
      boundary
    );
    const lifecycle = new HOSEngineLifecycleRegistry(boundary);

    app = createApp({
      hosRepositoryFactory: factory,
      hosEventMesh: eventMesh,
      hosLifecycle: lifecycle,
      hosBoundaryStore: boundary,
    });
  });

  afterEach(() => {
    delete process.env.HOS_EXECUTION_SHARED_SECRET;
    delete process.env.HEE_SECURITY_SECRET;
    process.env.EXECUTION_OS_IDENTITY_MODE = 'LEGACY_STANDALONE';
  });

  async function clientToken(assertion: HOSIdentityAssertion) {
    const response = await request(app)
      .post('/api/v1/hos/client-session')
      .set(headersFor(assertion))
      .send({ durationSeconds: 600 });

    expect(response.status).toBe(200);
    expect(response.body.data.tokenType).toBe('Bearer');
    return response.body.data.token as string;
  }

  it('mints a short-lived client session only after HOS assertion verification', async () => {
    const unsigned = await request(app)
      .post('/api/v1/hos/client-session')
      .send({ durationSeconds: 600 });
    expect(unsigned.status).toBe(401);

    const assertion = assertionFor('subject-e11-a');
    const token = await clientToken(assertion);
    expect(token.split('.')).toHaveLength(3);

    const state = await request(app)
      .get('/api/v1/client/state')
      .set('Authorization', `Bearer ${token}`);

    expect(state.status).toBe(200);
    expect(state.body.state.subjectId).toBe('subject-e11-a');
    expect(state.body.state.tenantId).toBe('tenant-e11');
  });

  it('rejects client API access without a delegated HOS client token', async () => {
    const response = await request(app).get('/api/v1/client/state');
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('executes a human decision through the subject-scoped authoritative command pipeline', async () => {
    const assertion = assertionFor('subject-e11-decision');
    const subject = HOSIdentityBridge.verifyAssertion(assertion, HOSIdentityBridge.signAssertion(assertion));
    const seeded = createEmptyExecutionState();
    seeded.subjectId = subject.subjectId;
    seeded.tenantId = subject.tenantId;
    seeded.activeHumanDecision = {
      id: 'decision-e11-1',
      prompt: 'Apply bounded recovery?',
      context: 'A schedule deviation needs a human choice.',
      options: [
        { id: 'approve-recovery', label: 'Approve recovery', description: 'Apply bounded recovery.' },
        { id: 'keep-plan', label: 'Keep current plan', description: 'Do not change.' },
      ],
      createdAt: new Date().toISOString(),
    } as any;
    await factory.seed(subject, seeded);

    const token = await clientToken(assertion);
    const first = await request(app)
      .post('/api/v1/client/commands')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'e11-decision-approve-1')
      .send({
        type: 'ApproveDecision',
        payload: { decisionId: 'decision-e11-1', optionId: 'approve-recovery' },
      });

    expect(first.status).toBe(200);
    expect(first.body.state.activeHumanDecision).toBeNull();
    expect(first.body.state.lastDecisionReason).toContain('approve-recovery');

    const replay = await request(app)
      .post('/api/v1/client/commands')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'e11-decision-approve-1')
      .send({
        type: 'ApproveDecision',
        payload: { decisionId: 'decision-e11-1', optionId: 'approve-recovery' },
      });

    expect(replay.status).toBe(200);
    expect(replay.headers['x-idempotent-replay']).toBe('true');
  });

  it('isolates authoritative browser state between HOS subjects', async () => {
    const aAssertion = assertionFor('subject-e11-a');
    const bAssertion = assertionFor('subject-e11-b');
    const a = HOSIdentityBridge.verifyAssertion(aAssertion, HOSIdentityBridge.signAssertion(aAssertion));

    const aState = createEmptyExecutionState();
    aState.subjectId = a.subjectId;
    aState.tenantId = a.tenantId;
    aState.rewardPoints = 77;
    await factory.seed(a, aState);

    const tokenA = await clientToken(aAssertion);
    const tokenB = await clientToken(bAssertion);

    const [stateA, stateB] = await Promise.all([
      request(app).get('/api/v1/client/state').set('Authorization', `Bearer ${tokenA}`),
      request(app).get('/api/v1/client/state').set('Authorization', `Bearer ${tokenB}`),
    ]);

    expect(stateA.body.state.rewardPoints).toBe(77);
    expect(stateB.body.state.rewardPoints).not.toBe(77);
    expect(stateB.body.state.subjectId).toBe('subject-e11-b');
  });
});
