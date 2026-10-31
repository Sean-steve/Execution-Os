import fs from 'fs';
import path from 'path';
import { SystemEvent } from '../types';

export type DeadLetterStatus = 'PENDING' | 'RETRIED_SUCCESS' | 'DISMISSED';

export interface DeadLetterEntry {
  id: string;
  event: SystemEvent;
  consumerName: string;
  errorMessage: string;
  errorStack?: string;
  attempts: number;
  firstFailedAt: string;
  lastFailedAt: string;
  status: DeadLetterStatus;
  retryResult?: {
    retriedAt: string;
    success: boolean;
    error?: string;
  };
}

export interface DeadLetterFilter {
  status?: DeadLetterStatus;
  consumerName?: string;
  eventType?: string;
  fromTime?: string;
  toTime?: string;
}

export interface IDeadLetterQueue {
  enqueue(entry: Omit<DeadLetterEntry, 'id' | 'status' | 'firstFailedAt' | 'lastFailedAt'>): Promise<DeadLetterEntry>;
  list(filter?: DeadLetterFilter): Promise<DeadLetterEntry[]>;
  getById(id: string): Promise<DeadLetterEntry | null>;
  markStatus(id: string, status: DeadLetterStatus, metadata?: Record<string, any>): Promise<void>;
  dismiss(id: string): Promise<void>;
  purge(): Promise<void>;
}

export class MemoryDeadLetterQueue implements IDeadLetterQueue {
  private entries: Map<string, DeadLetterEntry> = new Map();

  async enqueue(
    raw: Omit<DeadLetterEntry, 'id' | 'status' | 'firstFailedAt' | 'lastFailedAt'>
  ): Promise<DeadLetterEntry> {
    const id = `dlq-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    const entry: DeadLetterEntry = {
      ...raw,
      id,
      status: 'PENDING',
      firstFailedAt: now,
      lastFailedAt: now,
    };

    this.entries.set(id, entry);
    return entry;
  }

  async list(filter?: DeadLetterFilter): Promise<DeadLetterEntry[]> {
    let list = Array.from(this.entries.values());

    if (filter?.status) {
      list = list.filter(e => e.status === filter.status);
    }
    if (filter?.consumerName) {
      list = list.filter(e => e.consumerName === filter.consumerName);
    }
    if (filter?.eventType) {
      list = list.filter(e => e.event.event_type === filter.eventType);
    }
    if (filter?.fromTime) {
      list = list.filter(e => new Date(e.lastFailedAt) >= new Date(filter.fromTime!));
    }
    if (filter?.toTime) {
      list = list.filter(e => new Date(e.lastFailedAt) <= new Date(filter.toTime!));
    }

    return list.sort((a, b) => new Date(b.lastFailedAt).getTime() - new Date(a.lastFailedAt).getTime());
  }

  async getById(id: string): Promise<DeadLetterEntry | null> {
    return this.entries.get(id) || null;
  }

  async markStatus(id: string, status: DeadLetterStatus, metadata?: Record<string, any>): Promise<void> {
    const entry = this.entries.get(id);
    if (entry) {
      entry.status = status;
      if (metadata) {
        Object.assign(entry, metadata);
      }
    }
  }

  async dismiss(id: string): Promise<void> {
    await this.markStatus(id, 'DISMISSED');
  }

  async purge(): Promise<void> {
    this.entries.clear();
  }
}

export class FileDeadLetterQueue implements IDeadLetterQueue {
  private memory = new MemoryDeadLetterQueue();
  private entries = new Map<string, DeadLetterEntry>();

  constructor(private filePath = process.env.HEE_DLQ_PATH || path.join(process.cwd(), 'data', 'dead_letter_queue.json')) {
    this.load();
  }

  private load() {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      if (!raw.trim()) return;
      const parsed: DeadLetterEntry[] = JSON.parse(raw);
      this.entries = new Map(parsed.map(entry => [entry.id, entry]));
    } catch (error) {
      throw new Error(`Failed to load dead-letter queue: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private persist() {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify([...this.entries.values()], null, 2), { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(tmp, this.filePath);
    fs.chmodSync(this.filePath, 0o600);
  }

  async enqueue(raw: Omit<DeadLetterEntry, 'id' | 'status' | 'firstFailedAt' | 'lastFailedAt'>): Promise<DeadLetterEntry> {
    const id = `dlq-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    const entry: DeadLetterEntry = { ...raw, id, status: 'PENDING', firstFailedAt: now, lastFailedAt: now };
    this.entries.set(id, entry);
    this.persist();
    return JSON.parse(JSON.stringify(entry));
  }

  async list(filter?: DeadLetterFilter): Promise<DeadLetterEntry[]> {
    let list = [...this.entries.values()];
    if (filter?.status) list = list.filter(e => e.status === filter.status);
    if (filter?.consumerName) list = list.filter(e => e.consumerName === filter.consumerName);
    if (filter?.eventType) list = list.filter(e => e.event.event_type === filter.eventType);
    if (filter?.fromTime) list = list.filter(e => new Date(e.lastFailedAt) >= new Date(filter.fromTime!));
    if (filter?.toTime) list = list.filter(e => new Date(e.lastFailedAt) <= new Date(filter.toTime!));
    return JSON.parse(JSON.stringify(list.sort((a, b) => new Date(b.lastFailedAt).getTime() - new Date(a.lastFailedAt).getTime())));
  }

  async getById(id: string): Promise<DeadLetterEntry | null> {
    const entry = this.entries.get(id);
    return entry ? JSON.parse(JSON.stringify(entry)) : null;
  }

  async markStatus(id: string, status: DeadLetterStatus, metadata?: Record<string, any>): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.status = status;
    if (metadata) Object.assign(entry, metadata);
    this.entries.set(id, entry);
    this.persist();
  }

  async dismiss(id: string): Promise<void> {
    await this.markStatus(id, 'DISMISSED');
  }

  async purge(): Promise<void> {
    this.entries.clear();
    this.persist();
  }
}

const isNode = typeof window === 'undefined' && typeof process !== 'undefined' && Boolean(process.versions?.node);
export const defaultDeadLetterQueue: IDeadLetterQueue = isNode
  ? new FileDeadLetterQueue()
  : new MemoryDeadLetterQueue();
