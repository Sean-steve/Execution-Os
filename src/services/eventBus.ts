import {
  SystemEvent,
  EventType,
  AppState,
  RoutineState,
  SystemEventActor,
  SystemEventSubject,
  SystemEventMetadata,
} from '../types';
import { IClock, getClockForState } from '../clock';

export interface CreateEventOptions {
  actor?: SystemEventActor;
  subject?: SystemEventSubject;
  correlationId?: string;
  causationId?: string;
  scope?: string;
  engine?: string;
  policy?: string;
  rationale?: string;
  stateDiff?: Record<string, { before: any; after: any }> | Record<string, any>;
  tags?: string[];
  eventVersion?: string;
  clock?: IClock;
  additionalMetadata?: Record<string, any>;
}

export const createSystemEvent = (
  eventType: EventType,
  subjectOrOptions: SystemEventSubject | CreateEventOptions,
  payload: Record<string, any> = {},
  state: Partial<AppState> = {},
  actor: SystemEventActor = 'SYSTEM_KERNEL',
  causationId?: string,
  clock?: IClock
): SystemEvent => {
  // Support either legacy positional arguments or rich options object
  let options: CreateEventOptions = {};
  let subject: SystemEventSubject;

  if (typeof subjectOrOptions === 'object' && 'actor' in subjectOrOptions && !('type' in subjectOrOptions && 'id' in subjectOrOptions)) {
    options = subjectOrOptions as CreateEventOptions;
    subject = options.subject || 'DAY_EXECUTION_KERNEL';
  } else {
    subject = subjectOrOptions as SystemEventSubject;
    options = {
      actor,
      causationId,
      clock,
    };
  }

  const activeClock = options.clock || clock || getClockForState(state as AppState);
  const currentMinutes = state ? activeClock.getCurrentTimeMinutes() : 0;
  const eventActor: SystemEventActor = options.actor || actor || 'SYSTEM_KERNEL';
  const eventScope = options.scope || 'DAY_EXECUTION_KERNEL';
  const eventVersion = options.eventVersion || '1.0.0';

  const metadata: SystemEventMetadata = {
    currentMinutes,
    mode: state.currentMode || 'GREEN',
    routineState: state.routineState || 'STANDARD',
    engine: options.engine,
    policy: options.policy,
    rationale: options.rationale,
    stateDiff: options.stateDiff,
    tags: options.tags,
    schema_version: eventVersion,
    ...(options.additionalMetadata || {}),
  };

  const rawNow = activeClock.now();
  const ts = rawNow instanceof Date ? rawNow.getTime() : (typeof rawNow === 'number' ? rawNow : Date.now());

  return {
    event_id: `evt-${ts}-${Math.random().toString(36).substring(2, 9)}`,
    event_type: eventType,
    event_version: eventVersion,
    occurred_at: activeClock.toISOString(),
    actor: eventActor,
    subject,
    scope: eventScope,
    correlation_id: options.correlationId,
    causation_id: options.causationId || causationId,
    payload: payload || {},
    metadata,
  };
};

export const logEventToState = (
  state: AppState,
  eventType: EventType,
  subject: SystemEventSubject,
  payload: Record<string, any> = {},
  actor: SystemEventActor = 'SYSTEM_KERNEL',
  clock?: IClock,
  extra?: Partial<CreateEventOptions>
): AppState => {
  const event = createSystemEvent(
    eventType,
    {
      subject,
      actor,
      clock,
      ...extra,
    },
    payload,
    state
  );
  const events = [event, ...(state.events || [])].slice(0, 100);
  return {
    ...state,
    events,
  };
};
