import { BackgroundWorker } from '../services/backgroundWorker';
import { defaultClock } from '../clock';
import { HOSSubjectContext } from './identityBridge';
import { IHOSRepositoryFactory, HOSSubjectScopedRepositoryFactory } from './repositoryFactory';
import { HOSEngineLifecycleRegistry, HOSEngineLifecycleState, defaultHOSEngineLifecycleRegistry } from './lifecycle';
import { IHOSBoundaryStore, defaultHOSBoundaryStore } from './boundaryStore';
import {
  getExecutionPersistenceMode,
  getSharedPostgresPool,
  PostgresQueryable,
} from '../canonical/postgresCanonicalStorageEngine';

export interface HOSRuntimeStatus {
  subjectId: string;
  tenantId: string;
  lifecycle: HOSEngineLifecycleState;
  workerActive: boolean;
}

export class HOSSubjectRuntimeRegistry {
  private readonly workers = new Map<string, BackgroundWorker>();
  private runtimeSchemaReady: Promise<void> | null = null;

  constructor(
    private readonly repositories: IHOSRepositoryFactory = new HOSSubjectScopedRepositoryFactory(),
    private readonly lifecycle: HOSEngineLifecycleRegistry = defaultHOSEngineLifecycleRegistry,
    private readonly boundaryStore: IHOSBoundaryStore = defaultHOSBoundaryStore,
    private readonly postgres?: PostgresQueryable
  ) {}

  private key(subject: Pick<HOSSubjectContext, 'tenantId' | 'subjectId'>): string {
    return `${subject.tenantId}::${subject.subjectId}`;
  }

  private postgresPool(): PostgresQueryable | null {
    if (getExecutionPersistenceMode() !== 'postgres') return null;
    return this.postgres || getSharedPostgresPool();
  }

  private async ensureRuntimeSchema(): Promise<void> {
    const pool = this.postgresPool();
    if (!pool) return;
    if (!this.runtimeSchemaReady) {
      this.runtimeSchemaReady = pool.query(`
        CREATE TABLE IF NOT EXISTS execution_os_runtime_subjects (
          tenant_id TEXT NOT NULL,
          subject_id TEXT NOT NULL,
          lifecycle TEXT NOT NULL CHECK (lifecycle IN ('REGISTERED', 'ACTIVE', 'PAUSED', 'DEGRADED')),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (tenant_id, subject_id)
        )
      `).then(() => undefined).catch(error => {
        this.runtimeSchemaReady = null;
        throw error;
      });
    }
    await this.runtimeSchemaReady;
  }

  private async persistLifecycle(subject: HOSSubjectContext, state: HOSEngineLifecycleState): Promise<void> {
    const pool = this.postgresPool();
    if (!pool) return;
    await this.ensureRuntimeSchema();
    await pool.query(
      `INSERT INTO execution_os_runtime_subjects (tenant_id, subject_id, lifecycle)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, subject_id)
       DO UPDATE SET lifecycle = EXCLUDED.lifecycle, updated_at = NOW()`,
      [subject.tenantId, subject.subjectId, state]
    );
  }

  private workerFor(subject: HOSSubjectContext): BackgroundWorker {
    const key = this.key(subject);
    let worker = this.workers.get(key);
    if (!worker) {
      worker = new BackgroundWorker(
        this.repositories.forSubject(subject),
        defaultClock,
        {
          autoStart: false,
          enabled: true,
          tickIntervalMs: Number.parseInt(process.env.EXECUTION_OS_WORKER_TICK_MS || '30000', 10) || 30000,
          timezone: process.env.EXECUTION_OS_TIMEZONE || 'UTC',
        }
      );
      this.workers.set(key, worker);
    }
    return worker;
  }

  ensureForSubject(subject: HOSSubjectContext): HOSRuntimeStatus {
    const lifecycle = this.lifecycle.get(subject).state;
    const worker = this.workerFor(subject);
    if (lifecycle === 'ACTIVE') worker.start();
    else worker.stop();
    return {
      subjectId: subject.subjectId,
      tenantId: subject.tenantId,
      lifecycle,
      workerActive: worker.isWorkerActive(),
    };
  }

  async onLifecycleChange(subject: HOSSubjectContext, state: HOSEngineLifecycleState): Promise<HOSRuntimeStatus> {
    const worker = this.workerFor(subject);
    if (state === 'ACTIVE') worker.start();
    else worker.stop();
    await this.persistLifecycle(subject, state);
    return {
      subjectId: subject.subjectId,
      tenantId: subject.tenantId,
      lifecycle: state,
      workerActive: worker.isWorkerActive(),
    };
  }

  status(subject: HOSSubjectContext): HOSRuntimeStatus {
    const worker = this.workers.get(this.key(subject));
    return {
      subjectId: subject.subjectId,
      tenantId: subject.tenantId,
      lifecycle: this.lifecycle.get(subject).state,
      workerActive: Boolean(worker?.isWorkerActive()),
    };
  }

  async restoreActiveWorkers(): Promise<number> {
    const pool = this.postgresPool();
    const subjects: Array<{ tenantId: string; subjectId: string }> = [];

    if (pool) {
      await this.ensureRuntimeSchema();
      const result = await pool.query(
        `SELECT tenant_id, subject_id
         FROM execution_os_runtime_subjects
         WHERE lifecycle = 'ACTIVE'`
      );
      for (const row of result.rows) {
        subjects.push({ tenantId: row.tenant_id, subjectId: row.subject_id });
      }
    } else {
      const records = this.boundaryStore.listLifecycle?.() || [];
      for (const record of records) {
        if (record.state === 'ACTIVE') {
          subjects.push({ tenantId: record.tenantId, subjectId: record.subjectId });
        }
      }
    }

    for (const item of subjects) {
      const subject: HOSSubjectContext = {
        subjectId: item.subjectId,
        hosUserId: item.subjectId,
        tenantId: item.tenantId,
        permissions: [],
        consentScopes: [],
        issuer: 'HumanKernelOS',
        authenticatedAtUtc: new Date().toISOString(),
      };
      this.workerFor(subject).start();
    }
    return subjects.length;
  }

  shutdown(): void {
    for (const worker of this.workers.values()) worker.stop();
    this.workers.clear();
  }
}

export const defaultHOSSubjectRuntimeRegistry = new HOSSubjectRuntimeRegistry();
