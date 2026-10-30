import { SystemEvent, EventType } from '../types';
import path from 'path';

export interface EventFilter {
  eventTypes?: EventType[];
  correlationId?: string;
  causationId?: string;
  streamId?: string;
  scope?: string;
  actorType?: string;
  fromTime?: string;
  toTime?: string;
  fromSequence?: number;
  limit?: number;
  offset?: number;
}

export interface AppendResult {
  event: SystemEvent;
  isDuplicate: boolean;
  sequenceNumber: number;
  streamVersion: number;
}

export interface IDurableEventStore {
  append(event: SystemEvent): Promise<AppendResult>;
  appendBatch(events: SystemEvent[]): Promise<AppendResult[]>;
  getEvents(filter?: EventFilter): Promise<SystemEvent[]>;
  getEventById(eventId: string): Promise<SystemEvent | null>;
  getEventsByCorrelationId(correlationId: string): Promise<SystemEvent[]>;
  getEventsByCausationId(causationId: string): Promise<SystemEvent[]>;
  getEventsByStream(streamId: string, fromVersion?: number): Promise<SystemEvent[]>;
  getCausalChain(eventId: string): Promise<SystemEvent[]>;
  getStreamVersion(streamId: string): Promise<number>;
  getGlobalSequence(): Promise<number>;
  subscribe(handler: (event: SystemEvent) => void | Promise<void>): () => void;
  clear(): Promise<void>;
}

export class MemoryDurableEventStore implements IDurableEventStore {
  private events: SystemEvent[] = [];
  private eventIdMap: Map<string, SystemEvent> = new Map();
  private correlationMap: Map<string, string[]> = new Map();
  private causationMap: Map<string, string[]> = new Map();
  private streamVersions: Map<string, number> = new Map();
  private globalSequence: number = 0;
  private subscribers: Set<(event: SystemEvent) => void | Promise<void>> = new Set();

  constructor(initialEvents: SystemEvent[] = []) {
    if (initialEvents.length > 0) {
      for (const evt of initialEvents) {
        this.events.push(evt);
        this.eventIdMap.set(evt.event_id, evt);
        if (evt.correlation_id) {
          const list = this.correlationMap.get(evt.correlation_id) || [];
          list.push(evt.event_id);
          this.correlationMap.set(evt.correlation_id, list);
        }
        if (evt.causation_id) {
          const list = this.causationMap.get(evt.causation_id) || [];
          list.push(evt.event_id);
          this.causationMap.set(evt.causation_id, list);
        }
        const seq = evt.metadata?.sequence_number || 0;
        if (seq > this.globalSequence) this.globalSequence = seq;
      }
    }
  }

  async append(event: SystemEvent): Promise<AppendResult> {
    // 1. Duplicate detection
    if (this.eventIdMap.has(event.event_id)) {
      const existing = this.eventIdMap.get(event.event_id)!;
      return {
        event: existing,
        isDuplicate: true,
        sequenceNumber: existing.metadata?.sequence_number || 0,
        streamVersion: existing.metadata?.stream_version || 0,
      };
    }

    // 2. Stream and Sequence Assignment for deterministic aggregate ordering
    this.globalSequence += 1;
    const streamId = event.metadata?.stream_id || event.scope || 'DEFAULT_STREAM';
    const currentStreamVersion = (this.streamVersions.get(streamId) || 0) + 1;
    this.streamVersions.set(streamId, currentStreamVersion);

    const enrichedEvent: SystemEvent = {
      ...event,
      metadata: {
        ...event.metadata,
        sequence_number: this.globalSequence,
        stream_id: streamId,
        stream_version: currentStreamVersion,
      },
    };

    // 3. Append to log
    this.events.push(enrichedEvent);
    this.eventIdMap.set(enrichedEvent.event_id, enrichedEvent);

    // 4. Indexing
    if (enrichedEvent.correlation_id) {
      const list = this.correlationMap.get(enrichedEvent.correlation_id) || [];
      list.push(enrichedEvent.event_id);
      this.correlationMap.set(enrichedEvent.correlation_id, list);
    }

    if (enrichedEvent.causation_id) {
      const list = this.causationMap.get(enrichedEvent.causation_id) || [];
      list.push(enrichedEvent.event_id);
      this.causationMap.set(enrichedEvent.causation_id, list);
    }

    // 5. Notify subscribers asynchronously
    for (const sub of this.subscribers) {
      try {
        Promise.resolve(sub(enrichedEvent)).catch(err => {
          console.error('[EventStore Subscriber Error]', err);
        });
      } catch (err) {
        console.error('[EventStore Subscriber Dispatch Error]', err);
      }
    }

    return {
      event: enrichedEvent,
      isDuplicate: false,
      sequenceNumber: this.globalSequence,
      streamVersion: currentStreamVersion,
    };
  }

  async appendBatch(events: SystemEvent[]): Promise<AppendResult[]> {
    const results: AppendResult[] = [];
    for (const evt of events) {
      results.push(await this.append(evt));
    }
    return results;
  }

  async getEvents(filter: EventFilter = {}): Promise<SystemEvent[]> {
    let result = [...this.events];

    if (filter.eventTypes && filter.eventTypes.length > 0) {
      const typesSet = new Set(filter.eventTypes);
      result = result.filter(e => typesSet.has(e.event_type));
    }

    if (filter.correlationId) {
      result = result.filter(e => e.correlation_id === filter.correlationId);
    }

    if (filter.causationId) {
      result = result.filter(e => e.causation_id === filter.causationId);
    }

    if (filter.streamId) {
      result = result.filter(e => e.metadata?.stream_id === filter.streamId || e.scope === filter.streamId);
    }

    if (filter.scope) {
      result = result.filter(e => e.scope === filter.scope);
    }

    if (filter.fromTime) {
      result = result.filter(e => new Date(e.occurred_at) >= new Date(filter.fromTime!));
    }

    if (filter.toTime) {
      result = result.filter(e => new Date(e.occurred_at) <= new Date(filter.toTime!));
    }

    if (filter.fromSequence !== undefined) {
      result = result.filter(e => (e.metadata?.sequence_number || 0) >= filter.fromSequence!);
    }

    if (filter.offset && filter.offset > 0) {
      result = result.slice(filter.offset);
    }

    if (filter.limit && filter.limit > 0) {
      result = result.slice(0, filter.limit);
    }

    return result;
  }

  async getEventById(eventId: string): Promise<SystemEvent | null> {
    return this.eventIdMap.get(eventId) || null;
  }

  async getEventsByCorrelationId(correlationId: string): Promise<SystemEvent[]> {
    const ids = this.correlationMap.get(correlationId) || [];
    return ids.map(id => this.eventIdMap.get(id)!).filter(Boolean);
  }

  async getEventsByCausationId(causationId: string): Promise<SystemEvent[]> {
    const ids = this.causationMap.get(causationId) || [];
    return ids.map(id => this.eventIdMap.get(id)!).filter(Boolean);
  }

  async getEventsByStream(streamId: string, fromVersion: number = 0): Promise<SystemEvent[]> {
    return this.events.filter(e =>
      (e.metadata?.stream_id === streamId || e.scope === streamId) &&
      (e.metadata?.stream_version || 0) >= fromVersion
    );
  }

  async getCausalChain(eventId: string): Promise<SystemEvent[]> {
    const chain: SystemEvent[] = [];
    const visited = new Set<string>();
    let currentId: string | undefined = eventId;

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const evt = this.eventIdMap.get(currentId);
      if (!evt) break;
      chain.unshift(evt);
      currentId = evt.causation_id;
    }

    return chain;
  }

  async getStreamVersion(streamId: string): Promise<number> {
    return this.streamVersions.get(streamId) || 0;
  }

  async getGlobalSequence(): Promise<number> {
    return this.globalSequence;
  }

  subscribe(handler: (event: SystemEvent) => void | Promise<void>): () => void {
    this.subscribers.add(handler);
    return () => {
      this.subscribers.delete(handler);
    };
  }

  async clear(): Promise<void> {
    this.events = [];
    this.eventIdMap.clear();
    this.correlationMap.clear();
    this.causationMap.clear();
    this.streamVersions.clear();
    this.globalSequence = 0;
  }
}

export class FileDurableEventStore implements IDurableEventStore {
  private memoryStore: MemoryDurableEventStore;
  private filePath: string;
  private isFsAvailable: boolean = false;
  private fs: typeof import('fs/promises') | null = null;
  private fsSync: typeof import('fs') | null = null;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(customPath?: string) {
    const cwd = (typeof process !== 'undefined' && typeof process.cwd === 'function') ? process.cwd() : '.';
    const defaultPath = (typeof process !== 'undefined' && process.env?.HEE_EVENTS_PATH) || (path?.join ? path.join(cwd, 'data', 'durable_events_log.json') : `${cwd}/data/durable_events_log.json`);
    this.filePath = customPath || defaultPath;

    let initialEvents: SystemEvent[] = [];
    if (typeof window === 'undefined' && typeof process !== 'undefined' && process.versions?.node && typeof require === 'function') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        this.fsSync = require('fs');
        this.fs = require('fs').promises;
        this.isFsAvailable = true;

        if (this.fsSync && this.fsSync.existsSync(this.filePath)) {
          const content = this.fsSync.readFileSync(this.filePath, 'utf-8');
          if (content && content.trim() !== '') {
            initialEvents = JSON.parse(content);
          }
        }
      } catch (e) {
        console.warn('[FileDurableEventStore] Initial load warning:', e);
      }
    }

    this.memoryStore = new MemoryDurableEventStore(initialEvents);
  }

  private async persist(): Promise<void> {
    if (!this.isFsAvailable || !this.fs) return;

    this.writeLock = this.writeLock.then(async () => {
      try {
        const dir = path.dirname(this.filePath);
        await this.fs!.mkdir(dir, { recursive: true });
        const allEvents = await this.memoryStore.getEvents({ limit: 10000 });
        const tmpPath = `${this.filePath}.${Date.now()}.tmp`;
        await this.fs!.writeFile(tmpPath, JSON.stringify(allEvents, null, 2), 'utf-8');
        await this.fs!.rename(tmpPath, this.filePath);
      } catch (err) {
        console.error('[FileDurableEventStore] Persistence failure:', err);
      }
    });

    await this.writeLock;
  }

  async append(event: SystemEvent): Promise<AppendResult> {
    const res = await this.memoryStore.append(event);
    if (!res.isDuplicate) {
      await this.persist();
    }
    return res;
  }

  async appendBatch(events: SystemEvent[]): Promise<AppendResult[]> {
    const res = await this.memoryStore.appendBatch(events);
    await this.persist();
    return res;
  }

  getEvents(filter?: EventFilter): Promise<SystemEvent[]> {
    return this.memoryStore.getEvents(filter);
  }

  getEventById(eventId: string): Promise<SystemEvent | null> {
    return this.memoryStore.getEventById(eventId);
  }

  getEventsByCorrelationId(correlationId: string): Promise<SystemEvent[]> {
    return this.memoryStore.getEventsByCorrelationId(correlationId);
  }

  getEventsByCausationId(causationId: string): Promise<SystemEvent[]> {
    return this.memoryStore.getEventsByCausationId(causationId);
  }

  getEventsByStream(streamId: string, fromVersion?: number): Promise<SystemEvent[]> {
    return this.memoryStore.getEventsByStream(streamId, fromVersion);
  }

  getCausalChain(eventId: string): Promise<SystemEvent[]> {
    return this.memoryStore.getCausalChain(eventId);
  }

  getStreamVersion(streamId: string): Promise<number> {
    return this.memoryStore.getStreamVersion(streamId);
  }

  getGlobalSequence(): Promise<number> {
    return this.memoryStore.getGlobalSequence();
  }

  subscribe(handler: (event: SystemEvent) => void | Promise<void>): () => void {
    return this.memoryStore.subscribe(handler);
  }

  async clear(): Promise<void> {
    await this.memoryStore.clear();
    if (this.isFsAvailable && this.fsSync && this.fsSync.existsSync(this.filePath)) {
      try {
        await this.fs!.unlink(this.filePath);
      } catch (e) {}
    }
  }
}

export class LocalStorageDurableEventStore implements IDurableEventStore {
  private memoryStore: MemoryDurableEventStore;
  private storageKey: string;

  constructor(storageKey: string = 'hee_durable_event_store_v1') {
    this.storageKey = storageKey;
    let initialEvents: SystemEvent[] = [];
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem(this.storageKey);
        if (raw) {
          initialEvents = JSON.parse(raw);
        }
      }
    } catch (e) {
      console.warn('[LocalStorageDurableEventStore] Failed to load from localStorage:', e);
    }
    this.memoryStore = new MemoryDurableEventStore(initialEvents);
  }

  private persist() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        this.memoryStore.getEvents({ limit: 500 }).then(events => {
          window.localStorage.setItem(this.storageKey, JSON.stringify(events));
        });
      }
    } catch (e) {
      console.warn('[LocalStorageDurableEventStore] Failed to persist to localStorage:', e);
    }
  }

  async append(event: SystemEvent): Promise<AppendResult> {
    const res = await this.memoryStore.append(event);
    if (!res.isDuplicate) this.persist();
    return res;
  }

  async appendBatch(events: SystemEvent[]): Promise<AppendResult[]> {
    const res = await this.memoryStore.appendBatch(events);
    this.persist();
    return res;
  }

  getEvents(filter?: EventFilter): Promise<SystemEvent[]> {
    return this.memoryStore.getEvents(filter);
  }

  getEventById(eventId: string): Promise<SystemEvent | null> {
    return this.memoryStore.getEventById(eventId);
  }

  getEventsByCorrelationId(correlationId: string): Promise<SystemEvent[]> {
    return this.memoryStore.getEventsByCorrelationId(correlationId);
  }

  getEventsByCausationId(causationId: string): Promise<SystemEvent[]> {
    return this.memoryStore.getEventsByCausationId(causationId);
  }

  getEventsByStream(streamId: string, fromVersion?: number): Promise<SystemEvent[]> {
    return this.memoryStore.getEventsByStream(streamId, fromVersion);
  }

  getCausalChain(eventId: string): Promise<SystemEvent[]> {
    return this.memoryStore.getCausalChain(eventId);
  }

  getStreamVersion(streamId: string): Promise<number> {
    return this.memoryStore.getStreamVersion(streamId);
  }

  getGlobalSequence(): Promise<number> {
    return this.memoryStore.getGlobalSequence();
  }

  subscribe(handler: (event: SystemEvent) => void | Promise<void>): () => void {
    return this.memoryStore.subscribe(handler);
  }

  async clear(): Promise<void> {
    await this.memoryStore.clear();
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(this.storageKey);
      }
    } catch (e) {}
  }
}

const isNode = typeof window === 'undefined' && typeof process !== 'undefined' && Boolean(process.versions?.node);

export const defaultDurableEventStore: IDurableEventStore = isNode
  ? new FileDurableEventStore()
  : typeof window !== 'undefined' && window.localStorage
  ? new LocalStorageDurableEventStore()
  : new MemoryDurableEventStore();
