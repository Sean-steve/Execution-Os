import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createApp } from '../server/createApp';
import {
  HOSIdentityAssertion,
  HOSIdentityBridge,
  HOSSubjectContext,
} from '../hos/identityBridge';
import { IHOSRepositoryFactory } from '../hos/repositoryFactory';
import { IExecutionRepository } from '../repositories';
import { InMemoryExecutionRepository } from '../repositories/implementations';
import {
  HOSEventMeshBridge,
  HttpHOSEventMeshTransport,
  MemoryHOSEventMeshTransport,
  HOSEventEnvelope,
} from '../hos/eventMesh';
import { MemoryDeadLetterQueue } from '../services/deadLetterQueue';
import { HOSEngineLifecycleRegistry } from '../hos/lifecycle';
import { FileHOSBoundaryStore, MemoryHOSBoundaryStore } from '../hos/boundaryStore';
import { createEmptyExecutionState } from '../data/defaultData';
import { getHOSReadinessSnapshot, validateHOSProductionRuntime } from '../hos/productionHardening';

class SubjectFactory implements IHOSRepositoryFactory {
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

function assertionFor(subjectId = 'hos-e9-user', tenantId = 'tenant-e9'): HOSIdentityAssertion {
  return {
    subjectId,
    tenantId,
    permissions: [...PERMISSIONS],
    consentScopes: [...CONSENT],
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

describe('HumanKernelOS E8-E9 — Production Hardening & Integration Certification', () => {
  const envKeys = [
    'NODE_ENV',
    'EXECUTION_OS_IDENTITY_MODE',
    'HEE_SECURITY_SECRET',
    'HOS_EXECUTION_SHARED_SECRET',
    'HOS_EVENT_MESH_URL',
    'HOS_EVENT_MESH_TIMEOUT_MS',
    'HOS_BOUNDARY_STORE_PATH',
    'EXECUTION_OS_SUBJECT_DATA_DIR',
    'HEE_DLQ_PATH',
    'HOS_RATE_LIMIT_WINDOW_MS',
    'HOS_RATE_LIMIT_MAX_REQUESTS',
  ];
  const originalEnv: Record<string, string | undefined> = {};
  let tmpDir: string;

  beforeEach(() => {
    for (const key of envKeys) originalEnv[key] = process.env[key];
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'execution-os-e9-'));

    process.env.NODE_ENV = 'production';
    process.env.EXECUTION_OS_IDENTITY_MODE = 'HOS';
    process.env.HEE_SECURITY_SECRET = 'e9-execution-os-production-security-secret-32-plus';
    process.env.HOS_EXECUTION_SHARED_SECRET = 'e9-hos-shared-integration-secret-32-plus-chars';
    process.env.HOS_EVENT_MESH_URL = 'https://human-kernel.invalid/events';
    process.env.HOS_EVENT_MESH_TIMEOUT_MS = '50';
    process.env.HOS_BOUNDARY_STORE_PATH = path.join(tmpDir, 'boundary.json');
    process.env.EXECUTION_OS_SUBJECT_DATA_DIR = path.join(tmpDir, 'subjects');
    process.env.HEE_DLQ_PATH = path.join(tmpDir, 'dlq.json');
    process.env.HOS_RATE_LIMIT_WINDOW_MS = '60000';
    process.env.HOS_RATE_LIMIT_MAX_REQUESTS = '1000';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const key of envKeys) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function hardenedApp() {
    const factory = new SubjectFactory();
    const boundary = new MemoryHOSBoundaryStore();
    const transport = new MemoryHOSEventMeshTransport();
    const bridge = new HOSEventMeshBridge(transport, new MemoryDeadLetterQueue(), 1, boundary);
    const lifecycle = new HOSEngineLifecycleRegistry(boundary);
    const app = createApp({
      validateSecurityConfig: true,
      hosRepositoryFactory: factory,
      hosEventMesh: bridge,
      hosLifecycle: lifecycle,
      hosBoundaryStore: boundary,
    });
    return { app, factory, boundary, transport, lifecycle };
  }

  it('E8: fails closed when production HOS Event Mesh transport is absent, invalid, or non-TLS', () => {
    delete process.env.HOS_EVENT_MESH_URL;
    expect(validateHOSProductionRuntime().valid).toBe(false);
    expect(() => hardenedApp()).toThrow(/HOS_EVENT_MESH_URL/);

    process.env.HOS_EVENT_MESH_URL = 'http://human-kernel.invalid/events';
    const insecure = validateHOSProductionRuntime();
    expect(insecure.valid).toBe(false);
    expect(insecure.errors.join(' ')).toMatch(/HTTPS/);

    process.env.HOS_EVENT_MESH_URL = 'https://human-kernel.invalid/events';
    expect(validateHOSProductionRuntime().valid).toBe(true);
  });

  it('E8: exposes separate liveness/readiness and applies hardened API response headers', async () => {
    const { app } = hardenedApp();

    const live = await request(app).get('/api/health');
    expect(live.status).toBe(200);

    const ready = await request(app).get('/api/v1/hos/readiness');
    expect(ready.status).toBe(200);
    expect(ready.body.data.status).toBe('ready');
    expect(ready.body.data.identityAuthority).toBe('HumanKernelOS');
    expect(ready.body.data.scheduleAuthority).toBe('HumanKernelOS');
    expect(ready.headers['x-powered-by']).toBeUndefined();
    expect(ready.headers['x-content-type-options']).toBe('nosniff');
    expect(ready.headers['x-frame-options']).toBe('DENY');
    expect(ready.headers['cache-control']).toContain('no-store');

    const serialized = JSON.stringify(ready.body);
    expect(serialized).not.toContain(process.env.HOS_EXECUTION_SHARED_SECRET!);
    expect(serialized).not.toContain(process.env.HEE_SECURITY_SECRET!);
  });

  it('E8: rate-limits the HOS boundary with explicit Retry-After semantics', async () => {
    process.env.HOS_RATE_LIMIT_MAX_REQUESTS = '2';
    const { app } = hardenedApp();

    expect((await request(app).get('/api/v1/hos/manifest')).status).toBe(200);
    expect((await request(app).get('/api/v1/hos/manifest')).status).toBe(200);
    const limited = await request(app).get('/api/v1/hos/manifest');

    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('E8: times out a stalled Event Mesh delivery instead of hanging execution indefinitely', async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = vi.fn((_url: any, init: any) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const error: any = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    })) as any;

    const transport = new HttpHOSEventMeshTransport('https://human-kernel.invalid/events', 5);
    const envelope: HOSEventEnvelope = {
      id: 'event-timeout-e8',
      type: 'execution.activity.completed',
      version: '1.0',
      occurredAt: new Date().toISOString(),
      source: 'execution-os',
      subjectId: 'hos-e9-user',
      tenantId: 'tenant-e9',
      data: {},
    };

    try {
      await expect(transport.publish(envelope)).rejects.toThrow(/timed out/i);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it('E8: writes HOS boundary state with owner-only filesystem permissions', () => {
    const file = path.join(tmpDir, 'private-boundary.json');
    const store = new FileHOSBoundaryStore(file);
    store.setLifecycle('tenant-e9::hos-e9-user', {
      subjectId: 'hos-e9-user',
      tenantId: 'tenant-e9',
      state: 'ACTIVE',
      updatedAtUtc: new Date().toISOString(),
    });

    expect(fs.existsSync(file)).toBe(true);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('E9: publishes the certified E9 manifest while retaining HOS identity and schedule authority', async () => {
    const { app } = hardenedApp();
    const res = await request(app).get('/api/v1/hos/manifest');

    expect(res.status).toBe(200);
    expect(res.body.data.engineVersion).toBe('E9');
    expect(res.body.data.contractVersion).toBe('1.1.0');
    expect(res.body.data.identityAuthority).toBe('HumanKernelOS');
    expect(res.body.data.scheduleAuthority).toBe('HumanKernelOS');
    expect(res.body.data.consumesSignals).toContain('hos.human_state.updated');
    expect(res.body.data.consumesSignals).toContain('hos.pdie.recommendation.created');
    expect(res.body.data.publishesEvents).toContain('execution.behavior.signal');
  });

  it('E9: certifies signed HOS identity, permission/consent enforcement and legacy API isolation', async () => {
    const { app } = hardenedApp();
    const assertion = assertionFor();

    const unsigned = await request(app).get('/api/v1/hos/whoami');
    expect(unsigned.status).toBe(401);

    const signed = await request(app).get('/api/v1/hos/whoami').set(headersFor(assertion));
    expect(signed.status).toBe(200);
    expect(signed.body.data.subjectId).toBe(assertion.subjectId);
    expect(signed.body.data.issuer).toBe('HumanKernelOS');

    const legacy = await request(app)
      .get('/api/v1/hee/execution/now')
      .set(headersFor(assertion));
    expect(legacy.status).toBe(403);
    expect(legacy.body.code).toBe('AUTHORIZATION_FAILED');

    const noConsent = { ...assertion, consentScopes: assertion.consentScopes.filter(scope => scope !== 'execution.analytics') };
    const discipline = await request(app)
      .post('/api/v1/hos/capabilities/discipline.score.get')
      .set(headersFor(noConsent))
      .send({});
    expect(discipline.status).toBe(403);
  });

  it('E9: certifies HOS Daily Operating Plan authority plus bounded Human State and PDIE inputs end-to-end', async () => {
    const { app, factory } = hardenedApp();
    const assertion = assertionFor();
    const headers = headersFor(assertion);

    const plan = {
      planId: 'hos-e9-plan',
      planVersion: '1',
      subjectId: assertion.subjectId,
      localDate: '2026-10-31',
      timezone: 'Africa/Nairobi',
      source: 'HOS',
      receivedAtUtc: new Date().toISOString(),
      executionActivities: [],
      commitments: [],
      delegatedWindows: [],
    };

    const planRes = await request(app)
      .post('/api/v1/hos/signals')
      .set(headers)
      .set('Idempotency-Key', 'e9-plan-1')
      .send({ type: 'hos.daily_operating_plan.updated', data: { plan } });
    expect(planRes.status).toBe(200);
    expect(planRes.body.data.scheduleAuthority.mode).toBe('HOS');

    const humanContext = {
      contextId: 'e9-human-state',
      subjectId: assertion.subjectId,
      source: 'HumanKernelOS',
      sourceRef: 'hsv-projection-e9',
      schemaVersion: '1.0',
      observedAtUtc: new Date().toISOString(),
      validUntilUtc: new Date(Date.now() + 60000).toISOString(),
      confidence: 0.9,
      energyCapacity: 55,
      cognitiveCapacity: 48,
      recoveryNeed: 60,
      availability: 'LIMITED',
    };

    const humanRes = await request(app)
      .post('/api/v1/hos/signals')
      .set(headers)
      .set('Idempotency-Key', 'e9-human-1')
      .send({ type: 'hos.human_state.updated', data: { context: humanContext } });
    expect(humanRes.status).toBe(200);

    const recommendation = {
      id: 'e9-pdie-1',
      subjectId: assertion.subjectId,
      source: 'PDIE',
      recommendationVersion: '1',
      type: 'PREFER_RECOVERY',
      confidence: 0.8,
      rationale: 'Use lower execution load while recovery need is elevated.',
      evidenceRefs: ['execution-evidence-e9'],
      issuedAtUtc: new Date().toISOString(),
      expiresAtUtc: new Date(Date.now() + 60000).toISOString(),
      status: 'RECEIVED',
    };

    const pdieRes = await request(app)
      .post('/api/v1/hos/signals')
      .set(headers)
      .set('Idempotency-Key', 'e9-pdie-1')
      .send({ type: 'hos.pdie.recommendation.created', data: { recommendation } });
    expect(pdieRes.status).toBe(200);

    const schedule = await request(app)
      .post('/api/v1/hos/capabilities/schedule.get')
      .set(headers)
      .send({});
    expect(schedule.status).toBe(200);
    expect(schedule.body.data.data.authority.mode).toBe('HOS');
    expect(schedule.body.data.data.plan.planId).toBe('hos-e9-plan');

    const saved = await factory.forSubject(contextFor(assertion)).loadState();
    expect(saved.scheduleAuthority?.authoritativePlan?.planId).toBe('hos-e9-plan');
    expect(saved.hosHumanStateContext?.source).toBe('HumanKernelOS');
    expect(saved.pdieExecutionRecommendations?.[0]?.source).toBe('PDIE');
    expect((saved as any).hsv).toBeUndefined();
    expect((saved as any).personalPolicy).toBeUndefined();
  });

  it('E9: certifies subject/tenant isolation and lifecycle stop-control at the HOS boundary', async () => {
    const { app, factory } = hardenedApp();
    const alpha = assertionFor('alpha', 'tenant-e9');
    const beta = assertionFor('beta', 'tenant-e9');

    const alphaPlan = {
      planId: 'alpha-plan',
      planVersion: '1',
      subjectId: 'alpha',
      localDate: '2026-10-31',
      timezone: 'Africa/Nairobi',
      source: 'HOS',
      receivedAtUtc: new Date().toISOString(),
      executionActivities: [],
      commitments: [],
      delegatedWindows: [],
    };

    expect((await request(app)
      .post('/api/v1/hos/signals')
      .set(headersFor(alpha))
      .set('Idempotency-Key', 'alpha-plan')
      .send({ type: 'hos.daily_operating_plan.updated', data: { plan: alphaPlan } })).status).toBe(200);

    const betaState = await factory.forSubject(contextFor(beta)).loadState();
    expect(betaState.scheduleAuthority?.authoritativePlan).toBeFalsy();

    const pause = await request(app)
      .post('/api/v1/hos/lifecycle')
      .set(headersFor(alpha))
      .send({ action: 'PAUSE', reason: 'E9 certification stop-control' });
    expect(pause.status).toBe(200);
    expect(pause.body.data.state).toBe('PAUSED');

    const blocked = await request(app)
      .post('/api/v1/hos/capabilities/schedule.get')
      .set(headersFor(alpha))
      .send({});
    expect(blocked.status).toBe(400);
    expect(blocked.body.message).toMatch(/PAUSED/);
  });

  it('E9: readiness truth turns negative when HOS production transport becomes insecure', () => {
    expect(getHOSReadinessSnapshot().status).toBe('ready');

    process.env.HOS_EVENT_MESH_URL = 'http://human-kernel.invalid/events';
    const degraded = getHOSReadinessSnapshot();
    expect(degraded.status).toBe('not_ready');
    expect(degraded.checks.eventMeshTransport).toBe(false);
    expect(degraded.errors.join(' ')).toMatch(/HTTPS/);
  });
});
