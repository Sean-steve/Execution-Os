import { SystemEvent, EventType } from '../types';
import { IDeadLetterQueue, defaultDeadLetterQueue } from './deadLetterQueue';
import { EventUpcasterRegistry, defaultEventUpcasterRegistry } from './eventUpcaster';

export interface IEventConsumer {
  name: string;
  supportedEventTypes?: EventType[];
  handle(event: SystemEvent): Promise<void>;
}

export interface IProcessedEventStore {
  isProcessed(eventId: string, consumerName: string): Promise<boolean>;
  markProcessed(eventId: string, consumerName: string, result?: any): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryProcessedEventStore implements IProcessedEventStore {
  private processedMap: Set<string> = new Set();

  private makeKey(eventId: string, consumerName: string): string {
    return `${consumerName}::${eventId}`;
  }

  async isProcessed(eventId: string, consumerName: string): Promise<boolean> {
    return this.processedMap.has(this.makeKey(eventId, consumerName));
  }

  async markProcessed(eventId: string, consumerName: string): Promise<void> {
    this.processedMap.add(this.makeKey(eventId, consumerName));
  }

  async clear(): Promise<void> {
    this.processedMap.clear();
  }
}

export interface RetryPolicy {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  initialDelayMs: 20,
  maxDelayMs: 500,
  backoffFactor: 2,
};

export interface ConsumerExecutionResult {
  consumerName: string;
  status: 'PROCESSED' | 'SKIPPED_DUPLICATE' | 'FAILED_DEAD_LETTERED';
  attempts: number;
  error?: string;
}

export interface DispatchSummary {
  eventId: string;
  eventType: string;
  results: ConsumerExecutionResult[];
  success: boolean;
}

export class IdempotentEventDispatcher {
  private consumers: IEventConsumer[] = [];
  private processedStore: IProcessedEventStore;
  private deadLetterQueue: IDeadLetterQueue;
  private upcasterRegistry: EventUpcasterRegistry;
  private retryPolicy: RetryPolicy;

  constructor(options?: {
    processedStore?: IProcessedEventStore;
    deadLetterQueue?: IDeadLetterQueue;
    upcasterRegistry?: EventUpcasterRegistry;
    retryPolicy?: Partial<RetryPolicy>;
  }) {
    this.processedStore = options?.processedStore || new MemoryProcessedEventStore();
    this.deadLetterQueue = options?.deadLetterQueue || defaultDeadLetterQueue;
    this.upcasterRegistry = options?.upcasterRegistry || defaultEventUpcasterRegistry;
    this.retryPolicy = {
      ...DEFAULT_RETRY_POLICY,
      ...(options?.retryPolicy || {}),
    };
  }

  registerConsumer(consumer: IEventConsumer): void {
    const exists = this.consumers.some(c => c.name === consumer.name);
    if (!exists) {
      this.consumers.push(consumer);
    }
  }

  unregisterConsumer(consumerName: string): void {
    this.consumers = this.consumers.filter(c => c.name !== consumerName);
  }

  async dispatch(rawEvent: SystemEvent): Promise<DispatchSummary> {
    // 1. Upcast & normalize event
    const event = this.upcasterRegistry.upcast(rawEvent);
    const results: ConsumerExecutionResult[] = [];

    // 2. Find eligible consumers
    const eligibleConsumers = this.consumers.filter(c => {
      if (!c.supportedEventTypes || c.supportedEventTypes.length === 0) return true;
      return c.supportedEventTypes.includes(event.event_type);
    });

    // 3. Process with each consumer idempotently
    for (const consumer of eligibleConsumers) {
      const res = await this.executeConsumerWithRetry(consumer, event);
      results.push(res);
    }

    const allSucceeded = results.every(r => r.status !== 'FAILED_DEAD_LETTERED');

    return {
      eventId: event.event_id,
      eventType: event.event_type,
      results,
      success: allSucceeded,
    };
  }

  async dispatchBatch(events: SystemEvent[]): Promise<DispatchSummary[]> {
    const summaries: DispatchSummary[] = [];
    for (const evt of events) {
      summaries.push(await this.dispatch(evt));
    }
    return summaries;
  }

  private async executeConsumerWithRetry(
    consumer: IEventConsumer,
    event: SystemEvent
  ): Promise<ConsumerExecutionResult> {
    // Check if already processed (Idempotent protection)
    const alreadyProcessed = await this.processedStore.isProcessed(event.event_id, consumer.name);
    if (alreadyProcessed) {
      return {
        consumerName: consumer.name,
        status: 'SKIPPED_DUPLICATE',
        attempts: 0,
      };
    }

    let attempts = 0;
    let lastError: Error | null = null;

    while (attempts <= this.retryPolicy.maxRetries) {
      attempts++;
      try {
        await consumer.handle(event);

        // Mark successfully processed
        await this.processedStore.markProcessed(event.event_id, consumer.name);

        return {
          consumerName: consumer.name,
          status: 'PROCESSED',
          attempts,
        };
      } catch (err: any) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (attempts <= this.retryPolicy.maxRetries) {
          const delay = Math.min(
            this.retryPolicy.initialDelayMs * Math.pow(this.retryPolicy.backoffFactor, attempts - 1),
            this.retryPolicy.maxDelayMs
          );
          await new Promise(res => setTimeout(res, delay));
        }
      }
    }

    // Retries exhausted -> route to DLQ
    await this.deadLetterQueue.enqueue({
      event,
      consumerName: consumer.name,
      errorMessage: lastError?.message || 'Consumer execution failed',
      errorStack: lastError?.stack,
      attempts,
    });

    return {
      consumerName: consumer.name,
      status: 'FAILED_DEAD_LETTERED',
      attempts,
      error: lastError?.message || 'Unknown error',
    };
  }

  getProcessedStore(): IProcessedEventStore {
    return this.processedStore;
  }

  getDeadLetterQueue(): IDeadLetterQueue {
    return this.deadLetterQueue;
  }
}

export const defaultEventDispatcher = new IdempotentEventDispatcher();
