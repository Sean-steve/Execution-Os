import { BackgroundWorker } from '../services/backgroundWorker';
import { defaultClock } from '../clock';
import { HOSSubjectContext } from './identityBridge';
import { IHOSRepositoryFactory, HOSSubjectScopedRepositoryFactory } from './repositoryFactory';
import { HOSEngineLifecycleRegistry, HOSEngineLifecycleState, defaultHOSEngineLifecycleRegistry } from './lifecycle';
import { IHOSBoundaryStore, defaultHOSBoundaryStore } from './boundaryStore';

export interface HOSRuntimeStatus {
  subjectId: string;
  tenantId: string;
  lifecycle: HOSEngineLifecycleState;
  workerActive: boolean;
}

export class HOSSubjectRuntimeRegistry {
  private readonly workers = new Map<string, BackgroundWorker>();

  constructor(
    private readonly repositories: IHOSRepositoryFactory = new HOSSubjectScopedRepositoryFactory(),
    private readonly lifecycle: HOSEngineLifecycleRegistry = defaultHOSEngineLifecycleRegistry,
    private readonly boundaryStore: IHOSBoundaryStore = defaultHOSBoundaryStore
  ) {}

  private key(subject: Pick<HOSSubjectContext, 'tenantId' | 'subjectId'>): string {
    return `${subject.tenantId}::${subject.subjectId}`;
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

  onLifecycleChange(subject: HOSSubjectContext, state: HOSEngineLifecycleState): HOSRuntimeStatus {
    const worker = this.workerFor(subject);
    if (state === 'ACTIVE') worker.start();
    else worker.stop();
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

  restoreActiveWorkers(): number {
    const records = this.boundaryStore.listLifecycle?.() || [];
    let restored = 0;
    for (const record of records) {
      if (record.state !== 'ACTIVE') continue;
      const subject: HOSSubjectContext = {
        subjectId: record.subjectId,
        hosUserId: record.subjectId,
        tenantId: record.tenantId,
        permissions: [],
        consentScopes: [],
        issuer: 'HumanKernelOS',
        authenticatedAtUtc: new Date().toISOString(),
      };
      this.workerFor(subject).start();
      restored += 1;
    }
    return restored;
  }

  shutdown(): void {
    for (const worker of this.workers.values()) worker.stop();
    this.workers.clear();
  }
}

export const defaultHOSSubjectRuntimeRegistry = new HOSSubjectRuntimeRegistry();
