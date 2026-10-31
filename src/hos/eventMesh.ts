import crypto from 'crypto';
import { SystemEvent } from '../types';
import { IDeadLetterQueue, defaultDeadLetterQueue } from '../services/deadLetterQueue';
import { HOSSubjectContext } from './identityBridge';
import { IHOSBoundaryStore, MemoryHOSBoundaryStore, defaultHOSBoundaryStore } from './boundaryStore';

export interface HOSEventEnvelope {
  id: string;
  type: string;
  version: '1.0';
  occurredAt: string;
  source: 'execution-os';
  subjectId: string;
  tenantId: string;
  correlationId?: string;
  causationId?: string;
  data: Record<string, any>;
}

export interface HOSEventDeliveryAudit {
  eventId: string;
  hosEventType: string;
  subjectId: string;
  tenantId: string;
  status: 'DELIVERED' | 'SKIPPED_DUPLICATE' | 'FAILED_DEAD_LETTERED';
  attempts: number;
  lastAttemptAtUtc: string;
  error?: string;
}

export interface IHOSEventMeshTransport {
  publish(event: HOSEventEnvelope): Promise<void>;
}

export class MemoryHOSEventMeshTransport implements IHOSEventMeshTransport {
  readonly published: HOSEventEnvelope[] = [];
  async publish(event: HOSEventEnvelope): Promise<void> {
    this.published.push(JSON.parse(JSON.stringify(event)));
  }
}

export class HttpHOSEventMeshTransport implements IHOSEventMeshTransport {
  constructor(private endpoint = process.env.HOS_EVENT_MESH_URL || '') {}

  async publish(event: HOSEventEnvelope): Promise<void> {
    if (!this.endpoint) throw new Error('HOS_EVENT_MESH_URL is not configured.');
    const secret = process.env.HOS_EXECUTION_SHARED_SECRET?.trim();
    if (!secret || secret.length < 32) throw new Error('HOS_EXECUTION_SHARED_SECRET is not configured.');

    const body = JSON.stringify(event);
    const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-execution-os-signature': signature,
        'x-execution-os-event-id': event.id,
      },
      body,
    });
    if (!response.ok) {
      throw new Error(`HOS Event Mesh rejected event ${event.id} with HTTP ${response.status}.`);
    }
  }
}

const EVENT_MAP: Record<string, string> = {
  ActivityStarted: 'execution.activity.started',
  ActivityCompleted: 'execution.activity.completed',
  PerformanceSessionStarted: 'execution.session.started',
  PerformanceProgressRecorded: 'execution.session.advanced',
  PerformanceSessionClosed: 'execution.session.closed',
  FallbackTriggered: 'execution.fallback.triggered',
  ScheduleProposalCreated: 'execution.schedule.proposal.created',
  ScheduleProposalAccepted: 'execution.schedule.proposal.accepted',
  ScheduleProposalRejected: 'execution.schedule.proposal.rejected',
  HumanDecisionRequested: 'execution.decision.requested',
  DecisionRequested: 'execution.decision.requested',
};

export function mapExecutionEventToHOS(event: SystemEvent, subject: HOSSubjectContext): HOSEventEnvelope | null {
  const type = EVENT_MAP[event.event_type];
  if (!type) return null;
  return {
    id: event.event_id,
    type,
    version: '1.0',
    occurredAt: event.occurred_at,
    source: 'execution-os',
    subjectId: subject.subjectId,
    tenantId: subject.tenantId,
    correlationId: event.correlation_id,
    causationId: event.causation_id,
    data: {
      subject: event.subject,
      scope: event.scope,
      payload: event.payload,
      metadata: event.metadata,
    },
  };
}

export class HOSEventMeshBridge {
  constructor(
    private transport: IHOSEventMeshTransport = new HttpHOSEventMeshTransport(),
    private deadLetterQueue: IDeadLetterQueue = defaultDeadLetterQueue,
    private maxRetries = 3,
    private boundaryStore: IHOSBoundaryStore = new MemoryHOSBoundaryStore()
  ) {}

  private key(subject: HOSSubjectContext, eventId: string) {
    return `${subject.tenantId}::${subject.subjectId}::${eventId}`;
  }

  async publish(event: SystemEvent, subject: HOSSubjectContext): Promise<HOSEventDeliveryAudit | null> {
    const mapped = mapExecutionEventToHOS(event, subject);
    if (!mapped) return null;

    const key = this.key(subject, event.event_id);
    if (this.boundaryStore.hasProcessedEvent(key)) {
      const record: HOSEventDeliveryAudit = {
        eventId: event.event_id,
        hosEventType: mapped.type,
        subjectId: subject.subjectId,
        tenantId: subject.tenantId,
        status: 'SKIPPED_DUPLICATE',
        attempts: 0,
        lastAttemptAtUtc: new Date().toISOString(),
      };
      this.boundaryStore.addEventAudit(record);
      return record;
    }

    let attempts = 0;
    let lastError: Error | undefined;
    while (attempts <= this.maxRetries) {
      attempts += 1;
      try {
        await this.transport.publish(mapped);
        this.boundaryStore.markProcessedEvent(key);
        const record: HOSEventDeliveryAudit = {
          eventId: event.event_id,
          hosEventType: mapped.type,
          subjectId: subject.subjectId,
          tenantId: subject.tenantId,
          status: 'DELIVERED',
          attempts,
          lastAttemptAtUtc: new Date().toISOString(),
        };
        this.boundaryStore.addEventAudit(record);
        return record;
      } catch (err: any) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempts <= this.maxRetries) {
          await new Promise(resolve => setTimeout(resolve, Math.min(25 * Math.pow(2, attempts - 1), 250)));
        }
      }
    }

    const entry = await this.deadLetterQueue.enqueue({
      event,
      consumerName: 'hos-event-mesh',
      errorMessage: lastError?.message || 'HOS Event Mesh delivery failed',
      errorStack: lastError?.stack,
      attempts,
    });
    this.boundaryStore.setDLQSubject(entry.id, subject);
    const record: HOSEventDeliveryAudit = {
      eventId: event.event_id,
      hosEventType: mapped.type,
      subjectId: subject.subjectId,
      tenantId: subject.tenantId,
      status: 'FAILED_DEAD_LETTERED',
      attempts,
      lastAttemptAtUtc: new Date().toISOString(),
      error: lastError?.message,
    };
    this.boundaryStore.addEventAudit(record);
    return record;
  }

  async publishBatch(events: SystemEvent[], subject: HOSSubjectContext): Promise<HOSEventDeliveryAudit[]> {
    const results: HOSEventDeliveryAudit[] = [];
    for (const event of events) {
      const result = await this.publish(event, subject);
      if (result) results.push(result);
    }
    return results;
  }

  listAudit(subject?: HOSSubjectContext): HOSEventDeliveryAudit[] {
    return this.boundaryStore.listEventAudit()
      .filter(row => !subject || (row.subjectId === subject.subjectId && row.tenantId === subject.tenantId))
      .slice(0, 500);
  }

  async listDeadLetters(subject?: HOSSubjectContext) {
    const entries = await this.deadLetterQueue.list({ consumerName: 'hos-event-mesh' });
    if (!subject) return entries;
    return entries.filter(entry => {
      const context = this.boundaryStore.getDLQSubject(entry.id);
      return context?.subjectId === subject.subjectId && context?.tenantId === subject.tenantId;
    });
  }

  async retryDeadLetter(id: string): Promise<HOSEventDeliveryAudit> {
    const entry = await this.deadLetterQueue.getById(id);
    if (!entry || entry.consumerName !== 'hos-event-mesh') throw new Error(`HOS Event Mesh dead-letter ${id} not found.`);
    const subject = this.boundaryStore.getDLQSubject(id);
    if (!subject) throw new Error(`HOS subject context for dead-letter ${id} is unavailable.`);

    const result = await this.publish(entry.event, subject);
    if (!result) throw new Error('Dead-letter event does not map to a HOS Event Mesh event.');
    if (result.status === 'DELIVERED' || result.status === 'SKIPPED_DUPLICATE') {
      await this.deadLetterQueue.markStatus(id, 'RETRIED_SUCCESS', {
        retryResult: { retriedAt: new Date().toISOString(), success: true },
      });
    }
    return result;
  }
}

export const defaultHOSEventMeshBridge = new HOSEventMeshBridge(new HttpHOSEventMeshTransport(), defaultDeadLetterQueue, 3, defaultHOSBoundaryStore);
