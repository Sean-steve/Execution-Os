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

export const defaultDeadLetterQueue: IDeadLetterQueue = new MemoryDeadLetterQueue();
