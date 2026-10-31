import { HOSSubjectContext } from './identityBridge';
import { IHOSBoundaryStore, MemoryHOSBoundaryStore, defaultHOSBoundaryStore } from './boundaryStore';

export type HOSEngineLifecycleState = 'REGISTERED' | 'ACTIVE' | 'PAUSED' | 'DEGRADED';

export interface HOSEngineLifecycleRecord {
  subjectId: string;
  tenantId: string;
  state: HOSEngineLifecycleState;
  updatedAtUtc: string;
  reason?: string;
}

export class HOSEngineLifecycleRegistry {
  constructor(private store: IHOSBoundaryStore = new MemoryHOSBoundaryStore()) {}

  private key(subject: Pick<HOSSubjectContext, 'subjectId' | 'tenantId'>) {
    return `${subject.tenantId}::${subject.subjectId}`;
  }

  get(subject: HOSSubjectContext): HOSEngineLifecycleRecord {
    const record = this.store.getLifecycle(this.key(subject));
    return record || {
      subjectId: subject.subjectId,
      tenantId: subject.tenantId,
      state: 'REGISTERED',
      updatedAtUtc: new Date().toISOString(),
    };
  }

  set(subject: HOSSubjectContext, state: HOSEngineLifecycleState, reason?: string): HOSEngineLifecycleRecord {
    const record: HOSEngineLifecycleRecord = {
      subjectId: subject.subjectId,
      tenantId: subject.tenantId,
      state,
      updatedAtUtc: new Date().toISOString(),
      reason,
    };
    this.store.setLifecycle(this.key(subject), record);
    return record;
  }

  assertExecutable(subject: HOSSubjectContext): void {
    const record = this.get(subject);
    if (record.state === 'PAUSED' || record.state === 'DEGRADED') {
      throw new Error(`Execution OS lifecycle is ${record.state} for subject ${subject.subjectId}.`);
    }
  }
}

export const defaultHOSEngineLifecycleRegistry = new HOSEngineLifecycleRegistry(defaultHOSBoundaryStore);
