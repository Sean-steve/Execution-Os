import fs from 'fs';
import path from 'path';

export interface HOSBoundaryIdempotencyRecord {
  fingerprint: string;
  response: any;
  createdAtUtc: string;
}

export interface HOSBoundaryLifecycleRecord {
  subjectId: string;
  tenantId: string;
  state: 'REGISTERED' | 'ACTIVE' | 'PAUSED' | 'DEGRADED';
  updatedAtUtc: string;
  reason?: string;
}

export interface HOSBoundaryEventAuditRecord {
  eventId: string;
  hosEventType: string;
  subjectId: string;
  tenantId: string;
  status: 'DELIVERED' | 'SKIPPED_DUPLICATE' | 'FAILED_DEAD_LETTERED';
  attempts: number;
  lastAttemptAtUtc: string;
  error?: string;
}

export interface HOSBoundarySubjectRef {
  subjectId: string;
  hosUserId: string;
  tenantId: string;
  permissions: string[];
  consentScopes: string[];
  issuer: 'HumanKernelOS';
  authenticatedAtUtc: string;
}

interface HOSBoundarySnapshot {
  idempotency: Record<string, HOSBoundaryIdempotencyRecord>;
  lifecycle: Record<string, HOSBoundaryLifecycleRecord>;
  processedEvents: string[];
  eventAudit: HOSBoundaryEventAuditRecord[];
  dlqSubjects: Record<string, HOSBoundarySubjectRef>;
}

const emptySnapshot = (): HOSBoundarySnapshot => ({
  idempotency: {},
  lifecycle: {},
  processedEvents: [],
  eventAudit: [],
  dlqSubjects: {},
});

export interface IHOSBoundaryStore {
  getIdempotency(key: string): HOSBoundaryIdempotencyRecord | undefined;
  setIdempotency(key: string, record: HOSBoundaryIdempotencyRecord): void;
  getLifecycle(key: string): HOSBoundaryLifecycleRecord | undefined;
  setLifecycle(key: string, record: HOSBoundaryLifecycleRecord): void;
  hasProcessedEvent(key: string): boolean;
  markProcessedEvent(key: string): void;
  addEventAudit(record: HOSBoundaryEventAuditRecord): void;
  listEventAudit(): HOSBoundaryEventAuditRecord[];
  setDLQSubject(id: string, subject: HOSBoundarySubjectRef): void;
  getDLQSubject(id: string): HOSBoundarySubjectRef | undefined;
  clear(): void;
}

export class MemoryHOSBoundaryStore implements IHOSBoundaryStore {
  protected snapshot = emptySnapshot();

  getIdempotency(key: string) { return this.snapshot.idempotency[key]; }
  setIdempotency(key: string, record: HOSBoundaryIdempotencyRecord) { this.snapshot.idempotency[key] = JSON.parse(JSON.stringify(record)); }
  getLifecycle(key: string) { return this.snapshot.lifecycle[key]; }
  setLifecycle(key: string, record: HOSBoundaryLifecycleRecord) { this.snapshot.lifecycle[key] = JSON.parse(JSON.stringify(record)); }
  hasProcessedEvent(key: string) { return this.snapshot.processedEvents.includes(key); }
  markProcessedEvent(key: string) {
    if (!this.snapshot.processedEvents.includes(key)) this.snapshot.processedEvents.push(key);
  }
  addEventAudit(record: HOSBoundaryEventAuditRecord) {
    this.snapshot.eventAudit.unshift(JSON.parse(JSON.stringify(record)));
    this.snapshot.eventAudit = this.snapshot.eventAudit.slice(0, 2000);
  }
  listEventAudit() { return JSON.parse(JSON.stringify(this.snapshot.eventAudit)); }
  setDLQSubject(id: string, subject: HOSBoundarySubjectRef) { this.snapshot.dlqSubjects[id] = JSON.parse(JSON.stringify(subject)); }
  getDLQSubject(id: string) { return this.snapshot.dlqSubjects[id] ? JSON.parse(JSON.stringify(this.snapshot.dlqSubjects[id])) : undefined; }
  clear() { this.snapshot = emptySnapshot(); }
}

export class FileHOSBoundaryStore extends MemoryHOSBoundaryStore {
  constructor(private filePath = process.env.HOS_BOUNDARY_STORE_PATH || path.join(process.cwd(), 'data', 'hos_boundary_store.json')) {
    super();
    this.load();
  }

  private load() {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      if (!raw.trim()) return;
      const parsed = JSON.parse(raw);
      this.snapshot = {
        ...emptySnapshot(),
        ...parsed,
        idempotency: parsed.idempotency || {},
        lifecycle: parsed.lifecycle || {},
        processedEvents: parsed.processedEvents || [],
        eventAudit: parsed.eventAudit || [],
        dlqSubjects: parsed.dlqSubjects || {},
      };
    } catch (error) {
      throw new Error(`Failed to load HOS boundary store: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private persist() {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.snapshot, null, 2), 'utf-8');
    fs.renameSync(tmp, this.filePath);
  }

  override setIdempotency(key: string, record: HOSBoundaryIdempotencyRecord) { super.setIdempotency(key, record); this.persist(); }
  override setLifecycle(key: string, record: HOSBoundaryLifecycleRecord) { super.setLifecycle(key, record); this.persist(); }
  override markProcessedEvent(key: string) { super.markProcessedEvent(key); this.persist(); }
  override addEventAudit(record: HOSBoundaryEventAuditRecord) { super.addEventAudit(record); this.persist(); }
  override setDLQSubject(id: string, subject: HOSBoundarySubjectRef) { super.setDLQSubject(id, subject); this.persist(); }
  override clear() { super.clear(); this.persist(); }
}

const isNode = typeof window === 'undefined' && typeof process !== 'undefined' && Boolean(process.versions?.node);
export const defaultHOSBoundaryStore: IHOSBoundaryStore = isNode
  ? new FileHOSBoundaryStore()
  : new MemoryHOSBoundaryStore();
