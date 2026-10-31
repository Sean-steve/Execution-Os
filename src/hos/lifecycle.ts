import { HOSSubjectContext } from './identityBridge';

export type HOSEngineLifecycleState = 'REGISTERED' | 'ACTIVE' | 'PAUSED' | 'DEGRADED';

export interface HOSEngineLifecycleRecord {
  subjectId: string;
  tenantId: string;
  state: HOSEngineLifecycleState;
  updatedAtUtc: string;
  reason?: string;
}

export class HOSEngineLifecycleRegistry {
  private records = new Map<string, HOSEngineLifecycleRecord>();

  private key(subject: Pick<HOSSubjectContext, 'subjectId' | 'tenantId'>) {
    return `${subject.tenantId}::${subject.subjectId}`;
  }

  get(subject: HOSSubjectContext): HOSEngineLifecycleRecord {
    const key = this.key(subject);
    return this.records.get(key) || {
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
    this.records.set(this.key(subject), record);
    return record;
  }

  assertExecutable(subject: HOSSubjectContext): void {
    const record = this.get(subject);
    if (record.state === 'PAUSED' || record.state === 'DEGRADED') {
      throw new Error(`Execution OS lifecycle is ${record.state} for subject ${subject.subjectId}.`);
    }
  }
}

export const defaultHOSEngineLifecycleRegistry = new HOSEngineLifecycleRegistry();
