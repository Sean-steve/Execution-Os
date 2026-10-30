import {
  SystemEvent,
  EventType,
  SystemEventActor,
  SystemEventSubject,
  SystemEventMetadata,
} from '../types';

export interface EventSchemaValidationResult {
  valid: boolean;
  errors: string[];
}

export type EventUpcasterFn = (event: SystemEvent) => SystemEvent;

export class EventUpcasterRegistry {
  private upcasters: Map<string, EventUpcasterFn[]> = new Map();

  /**
   * Register an upcaster function for a specific event type and source version.
   * key format: `${eventType}:${sourceVersion}`
   */
  registerUpcaster(eventType: EventType | '*', sourceVersion: string, upcaster: EventUpcasterFn): void {
    const key = `${eventType}:${sourceVersion}`;
    const list = this.upcasters.get(key) || [];
    list.push(upcaster);
    this.upcasters.set(key, list);
  }

  /**
   * Normalizes and upcasts an event to the latest canonical schema version.
   */
  upcast(event: SystemEvent, targetVersion: string = '1.1.0'): SystemEvent {
    let current = this.normalize(event);

    // Run wildcard upcasters for source version
    const wildcardKey = `*:${current.event_version}`;
    const wildcardUpcasters = this.upcasters.get(wildcardKey) || [];
    for (const fn of wildcardUpcasters) {
      current = fn(current);
    }

    // Run type-specific upcasters
    const typeKey = `${current.event_type}:${current.event_version}`;
    const typeUpcasters = this.upcasters.get(typeKey) || [];
    for (const fn of typeUpcasters) {
      current = fn(current);
    }

    // Set target version if transformed
    current.event_version = targetVersion;
    return current;
  }

  /**
   * Normalizes envelope fields ensuring required properties exist.
   */
  normalize(event: any): SystemEvent {
    const occurred_at = event.occurred_at || new Date().toISOString();
    const event_id = event.event_id || `evt-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const event_type = event.event_type || 'ExecutionStarted';
    const event_version = event.event_version || '1.0.0';
    const actor: SystemEventActor = event.actor || 'SYSTEM_KERNEL';
    const subject: SystemEventSubject = event.subject || 'DAY_EXECUTION_KERNEL';
    const scope = event.scope || 'DAY_EXECUTION_KERNEL';
    const payload = event.payload || {};
    const metadata: SystemEventMetadata = {
      currentMinutes: event.metadata?.currentMinutes ?? 0,
      mode: event.metadata?.mode ?? 'GREEN',
      routineState: event.metadata?.routineState ?? 'STANDARD',
      engine: event.metadata?.engine,
      policy: event.metadata?.policy,
      rationale: event.metadata?.rationale,
      stateDiff: event.metadata?.stateDiff,
      sequence_number: event.metadata?.sequence_number,
      stream_id: event.metadata?.stream_id || scope,
      stream_version: event.metadata?.stream_version,
      tags: event.metadata?.tags || [],
      schema_version: event_version,
      ...(event.metadata || {}),
    };

    return {
      event_id,
      event_type,
      event_version,
      occurred_at,
      actor,
      subject,
      scope,
      correlation_id: event.correlation_id,
      causation_id: event.causation_id,
      payload,
      metadata,
    };
  }

  /**
   * Validates that an event strictly conforms to the required event envelope specification.
   */
  validateEnvelope(event: any): EventSchemaValidationResult {
    const errors: string[] = [];

    if (!event) {
      return { valid: false, errors: ['Event object is null or undefined'] };
    }

    if (!event.event_id || typeof event.event_id !== 'string') {
      errors.push('Missing or invalid event_id (string required)');
    }

    if (!event.event_type || typeof event.event_type !== 'string') {
      errors.push('Missing or invalid event_type (string required)');
    }

    if (!event.event_version || typeof event.event_version !== 'string') {
      errors.push('Missing or invalid event_version (semver string required)');
    }

    if (!event.occurred_at || typeof event.occurred_at !== 'string') {
      errors.push('Missing or invalid occurred_at (ISO timestamp required)');
    }

    if (!event.actor) {
      errors.push('Missing actor in event envelope');
    }

    if (!event.subject) {
      errors.push('Missing subject in event envelope');
    }

    if (!event.scope || typeof event.scope !== 'string') {
      errors.push('Missing or invalid scope (string required)');
    }

    if (event.payload === undefined || typeof event.payload !== 'object') {
      errors.push('Missing or invalid payload (object required)');
    }

    if (!event.metadata || typeof event.metadata !== 'object') {
      errors.push('Missing or invalid metadata (object required)');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

export const defaultEventUpcasterRegistry = new EventUpcasterRegistry();

// Register default 1.0.0 -> 1.1.0 upcaster
defaultEventUpcasterRegistry.registerUpcaster('*', '1.0.0', (evt) => {
  return {
    ...evt,
    metadata: {
      ...evt.metadata,
      schema_version: '1.1.0',
      tags: evt.metadata?.tags || ['v1_upcasted'],
    },
  };
});
