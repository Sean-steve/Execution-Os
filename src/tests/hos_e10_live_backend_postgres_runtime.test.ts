import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEmptyCanonicalSchema } from '../canonical/canonicalDatabase';
import {
  getExecutionPersistenceMode,
  PostgresCanonicalStorageEngine,
  PostgresQueryable,
} from '../canonical/postgresCanonicalStorageEngine';
import { HOSSubjectContext } from '../hos/identityBridge';
import { IHOSRepositoryFactory } from '../hos/repositoryFactory';
import { IExecutionRepository } from '../repositories';
import { InMemoryExecutionRepository } from '../repositories/implementations';
import { createEmptyExecutionState } from '../data/defaultData';
import { MemoryHOSBoundaryStore } from '../hos/boundaryStore';
import { HOSEngineLifecycleRegistry } from '../hos/lifecycle';
import { HOSSubjectRuntimeRegistry } from '../hos/runtimeRegistry';
import { getHOSReadinessSnapshot, validateHOSProductionRuntime } from '../hos/productionHardening';

class FakePostgres implements PostgresQueryable {
  state = new Map<string, any>();
  runtime = new Map<string, string>();

  async query(text: string, values: any[] = []): Promise<any> {
    const sql = text.replace(/\s+/g, ' ').trim();

    if (sql.startsWith('CREATE TABLE') || sql.startsWith('CREATE INDEX')) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith('SELECT 1 AS ok')) {
      return { rows: [{ ok: 1 }], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO execution_os_subject_state')) {
      this.state.set(`${values[0]}::${values[1]}`, JSON.parse(values[2]));
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('SELECT state FROM execution_os_subject_state')) {
      const state = this.state.get(`${values[0]}::${values[1]}`);
      return { rows: state ? [{ state }] : [], rowCount: state ? 1 : 0 };
    }
    if (sql.startsWith('DELETE FROM execution_os_subject_state')) {
      this.state.delete(`${values[0]}::${values[1]}`);
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO execution_os_runtime_subjects')) {
      this.runtime.set(`${values[0]}::${values[1]}`, values[2]);
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('FROM execution_os_runtime_subjects') && sql.includes("lifecycle = 'ACTIVE'")) {
      const rows = [...this.runtime.entries()]
        .filter(([, lifecycle]) => lifecycle === 'ACTIVE')
        .map(([key]) => {
          const [tenant_id, subject_id] = key.split('::');
          return { tenant_id, subject_id };
        });
      return { rows, rowCount: rows.length };
    }

    throw new Error(`Unhandled fake PostgreSQL query: ${sql}`);
  }
}

class SubjectFactory implements IHOSRepositoryFactory {
  private repos = new Map<string, IExecutionRepository>();

  forSubject(subject: HOSSubjectContext): IExecutionRepository {
    const key = `${subject.tenantId}::${subject.subjectId}`;
    let repo = this.repos.get(key);
    if (!repo) {
      repo = new InMemoryExecutionRepository(createEmptyExecutionState());
      this.repos.set(key, repo);
    }
    return repo;
  }
}

describe('HOS E10 — Live Backend, PostgreSQL Persistence & Runtime Activation', () => {
  const keys = [
    'NODE_ENV',
    'EXECUTION_OS_IDENTITY_MODE',
    'EXECUTION_OS_PERSISTENCE',
    'EXECUTION_OS_REQUIRE_POSTGRES',
    'DATABASE_URL',
    'DATABASE_SSL',
    'HOS_EVENT_MESH_URL',
  ];
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of keys) original[key] = process.env[key];
  });

  afterEach(() => {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  it('persists canonical subject state in PostgreSQL with tenant and subject isolation', async () => {
    const pool = new FakePostgres();
    const alice = new PostgresCanonicalStorageEngine({
      tenantId: 'tenant-a',
      subjectId: 'alice',
      pool,
    });
    const bob = new PostgresCanonicalStorageEngine({
      tenantId: 'tenant-a',
      subjectId: 'bob',
      pool,
    });

    const state = createEmptyCanonicalSchema();
    state.profiles.push({
      id: 'profile-alice',
      userId: 'alice',
      timezone: 'Africa/Nairobi',
      default_mode: 'NORMAL' as any,
      autonomy_level: 1 as any,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    } as any);

    await alice.saveData(state);
    expect((await alice.loadData())?.profiles[0]?.userId).toBe('alice');
    expect(await bob.loadData()).toBeNull();

    await alice.clear();
    expect(await alice.loadData()).toBeNull();
  });

  it('durably records ACTIVE lifecycle and restores subject-aware workers after restart', async () => {
    process.env.EXECUTION_OS_PERSISTENCE = 'postgres';
    process.env.DATABASE_URL = 'postgresql://execution:test@localhost/execution_test';

    const pool = new FakePostgres();
    const boundary = new MemoryHOSBoundaryStore();
    const lifecycle = new HOSEngineLifecycleRegistry(boundary);
    const repositories = new SubjectFactory();
    const subject: HOSSubjectContext = {
      subjectId: 'subject-e10',
      hosUserId: 'subject-e10',
      tenantId: 'tenant-e10',
      permissions: [],
      consentScopes: [],
      issuer: 'HumanKernelOS',
      authenticatedAtUtc: new Date().toISOString(),
    };

    lifecycle.set(subject, 'ACTIVE');
    const runtimeA = new HOSSubjectRuntimeRegistry(repositories, lifecycle, boundary, pool);
    const active = await runtimeA.onLifecycleChange(subject, 'ACTIVE');
    expect(active.workerActive).toBe(true);
    runtimeA.shutdown();

    const restoredBoundary = new MemoryHOSBoundaryStore();
    const restoredLifecycle = new HOSEngineLifecycleRegistry(restoredBoundary);
    const runtimeB = new HOSSubjectRuntimeRegistry(repositories, restoredLifecycle, restoredBoundary, pool);
    expect(await runtimeB.restoreActiveWorkers()).toBe(1);
    expect(runtimeB.status(subject).workerActive).toBe(true);
    expect(runtimeB.status(subject).lifecycle).toBe('ACTIVE');
    runtimeB.shutdown();
  });

  it('certifies the PostgreSQL E10 production configuration contract', () => {
    process.env.NODE_ENV = 'production';
    process.env.EXECUTION_OS_IDENTITY_MODE = 'HOS';
    process.env.EXECUTION_OS_PERSISTENCE = 'postgres';
    process.env.EXECUTION_OS_REQUIRE_POSTGRES = 'true';
    process.env.DATABASE_URL = 'postgresql://execution:secret@db.internal/execution';
    process.env.DATABASE_SSL = 'require';
    process.env.HOS_EVENT_MESH_URL = 'https://human-kernel.example/events';

    expect(getExecutionPersistenceMode()).toBe('postgres');
    const validation = validateHOSProductionRuntime();
    expect(validation.valid).toBe(true);

    const readiness = getHOSReadinessSnapshot();
    expect(readiness.status).toBe('ready');
    expect(readiness.checks.postgresPersistence).toBe(true);
    expect(readiness.checks.databaseConfigured).toBe(true);

    delete process.env.DATABASE_URL;
    expect(validateHOSProductionRuntime().valid).toBe(false);
  });
});
