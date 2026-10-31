import {
  AppState,
  ExecutionBehavioralSignal,
  HOSHumanStateExecutionContext,
  PDIEExecutionRecommendation,
  RoutineTask,
  SystemEvent,
} from '../types';

const clamp = (value: number | undefined, min = 0, max = 100) =>
  value === undefined ? undefined : Math.max(min, Math.min(max, Number(value)));

function activeContext(state: AppState): HOSHumanStateExecutionContext | undefined {
  const context = state.hosHumanStateContext;
  if (!context) return undefined;
  if (context.validUntilUtc && Date.parse(context.validUntilUtc) < Date.now()) return undefined;
  return context;
}

function activePDIE(state: AppState): PDIEExecutionRecommendation[] {
  const now = Date.now();
  return (state.pdieExecutionRecommendations || []).filter(rec =>
    rec.status === 'ACTIVE_ADVISORY' &&
    (!rec.expiresAtUtc || Date.parse(rec.expiresAtUtc) >= now)
  );
}

export function acceptHOSHumanStateContext(
  state: AppState,
  input: HOSHumanStateExecutionContext
): AppState {
  if (!input.contextId || !input.subjectId || input.source !== 'HumanKernelOS' || !input.sourceRef || !input.observedAtUtc) {
    throw new Error('Invalid HumanKernelOS Human State execution context.');
  }
  if (state.subjectId && input.subjectId !== state.subjectId) {
    throw new Error(`Human State subject mismatch: context belongs to ${input.subjectId}, execution state belongs to ${state.subjectId}.`);
  }

  const sanitized: HOSHumanStateExecutionContext = {
    contextId: input.contextId,
    subjectId: input.subjectId,
    source: 'HumanKernelOS',
    sourceRef: input.sourceRef,
    schemaVersion: input.schemaVersion || '1.0',
    observedAtUtc: input.observedAtUtc,
    validUntilUtc: input.validUntilUtc,
    confidence: Math.max(0, Math.min(1, Number(input.confidence ?? 0))),
    energyCapacity: clamp(input.energyCapacity),
    cognitiveCapacity: clamp(input.cognitiveCapacity),
    physicalCapacity: clamp(input.physicalCapacity),
    recoveryNeed: clamp(input.recoveryNeed),
    stressLoad: clamp(input.stressLoad),
    attentionStability: clamp(input.attentionStability),
    availability: input.availability,
    locationContext: input.locationContext,
    executionConstraints: [...new Set((input.executionConstraints || []).map(String))],
  };

  return {
    ...state,
    hosHumanStateContext: sanitized,
  };
}

export function acceptPDIEExecutionRecommendation(
  state: AppState,
  input: PDIEExecutionRecommendation
): AppState {
  if (!input.id || !input.subjectId || input.source !== 'PDIE' || !input.type || !input.issuedAtUtc) {
    throw new Error('Invalid PDIE execution recommendation.');
  }
  if (state.subjectId && input.subjectId !== state.subjectId) {
    throw new Error(`PDIE subject mismatch: recommendation belongs to ${input.subjectId}, execution state belongs to ${state.subjectId}.`);
  }

  const allowedTypes = new Set([
    'PREFER_SHORTER_BLOCKS',
    'PREFER_RECOVERY',
    'REDUCE_CONTEXT_SWITCHING',
    'PREFER_LOWER_COGNITIVE_LOAD',
    'PREFER_LOWER_PHYSICAL_LOAD',
  ]);
  if (!allowedTypes.has(input.type)) {
    throw new Error(`Unsupported PDIE execution recommendation type "${input.type}".`);
  }

  const recommendation: PDIEExecutionRecommendation = {
    ...input,
    source: 'PDIE',
    confidence: Math.max(0, Math.min(1, Number(input.confidence ?? 0))),
    evidenceRefs: [...new Set((input.evidenceRefs || []).map(String))],
    status: input.expiresAtUtc && Date.parse(input.expiresAtUtc) < Date.now()
      ? 'EXPIRED'
      : 'ACTIVE_ADVISORY',
    parameters: input.parameters
      ? {
          maxBlockMinutes: input.parameters.maxBlockMinutes
            ? Math.max(10, Math.min(240, Number(input.parameters.maxBlockMinutes)))
            : undefined,
          strength: input.parameters.strength === undefined
            ? undefined
            : Math.max(0, Math.min(1, Number(input.parameters.strength))),
        }
      : undefined,
  };

  const others = (state.pdieExecutionRecommendations || []).filter(existing => existing.id !== recommendation.id);
  return {
    ...state,
    pdieExecutionRecommendations: [recommendation, ...others].slice(0, 100),
  };
}

function isCognitive(task: RoutineTask) {
  return task.category === 'DEEP_WORK' ||
    task.category === 'BUSINESS' ||
    task.interactiveActionType === 'FOCUS_BLOCK' ||
    task.interactiveActionType === 'COMMAND_CENTER' ||
    task.interactiveActionType === 'COMPANY_TARGET';
}

function isPhysical(task: RoutineTask) {
  return task.category === 'FITNESS' ||
    task.interactiveActionType === 'WORKOUT_TRACKER' ||
    task.interactiveActionType === 'OUTSIDE_TIMER';
}

function isRecovery(task: RoutineTask) {
  return task.category === 'RECOVERY' ||
    task.interactiveActionType === 'MEDITATION_TIMER';
}

/**
 * Soft execution-fit signal only. It cannot override HOS schedule boundaries,
 * protected commitments, dependencies, external gates, or Personal Policy.
 */
export function getHumanStateExecutionFitModifier(state: AppState, task: RoutineTask): number {
  const context = activeContext(state);
  let score = 0;

  if (context) {
    if (isCognitive(task) && context.cognitiveCapacity !== undefined) {
      score += (context.cognitiveCapacity - 50) / 10;
    }
    if (isPhysical(task) && context.physicalCapacity !== undefined) {
      score += (context.physicalCapacity - 50) / 12;
    }
    if (isRecovery(task) && context.recoveryNeed !== undefined) {
      score += (context.recoveryNeed - 50) / 8;
    }
    if (isCognitive(task) && context.attentionStability !== undefined) {
      score += (context.attentionStability - 50) / 14;
    }
    if ((isCognitive(task) || isPhysical(task)) && context.stressLoad !== undefined) {
      score -= Math.max(0, context.stressLoad - 60) / 15;
    }
    if (context.availability === 'LIMITED') score -= 1.5;
    if (context.availability === 'UNAVAILABLE') score -= 5;
  }

  for (const recommendation of activePDIE(state)) {
    const strength = recommendation.parameters?.strength ?? recommendation.confidence;
    if (recommendation.type === 'PREFER_RECOVERY') {
      score += isRecovery(task) ? 5 * strength : -2 * strength;
    } else if (recommendation.type === 'PREFER_LOWER_COGNITIVE_LOAD' && isCognitive(task)) {
      score -= 4 * strength;
    } else if (recommendation.type === 'PREFER_LOWER_PHYSICAL_LOAD' && isPhysical(task)) {
      score -= 4 * strength;
    } else if (recommendation.type === 'PREFER_SHORTER_BLOCKS') {
      const duration = Math.max(1, (task.allocatedEndMinutes ?? task.endMinutes) - (task.allocatedStartMinutes ?? task.startMinutes));
      const maxBlock = recommendation.parameters?.maxBlockMinutes || 45;
      if (duration > maxBlock) score -= Math.min(4, (duration - maxBlock) / 15) * strength;
    }
  }

  return Math.round(Math.max(-10, Math.min(10, score)) * 10) / 10;
}

export function getHumanStateDecisionExplanation(state: AppState, task: RoutineTask): string | null {
  const context = activeContext(state);
  const recommendations = activePDIE(state);
  if (!context && recommendations.length === 0) return null;

  const fit = getHumanStateExecutionFitModifier(state, task);
  const parts: string[] = [];
  if (context) {
    parts.push(`HOS Human State context ${context.contextId} contributes execution-fit ${fit >= 0 ? '+' : ''}${fit}`);
  } else {
    parts.push(`PDIE advisory contributes execution-fit ${fit >= 0 ? '+' : ''}${fit}`);
  }
  if (context?.recoveryNeed !== undefined && context.recoveryNeed >= 70) parts.push('recovery need is elevated');
  if (context?.cognitiveCapacity !== undefined && context.cognitiveCapacity <= 40) parts.push('cognitive capacity is constrained');
  return parts.join('; ') + '.';
}

export function projectExecutionBehavioralSignal(
  event: SystemEvent,
  state?: AppState
): ExecutionBehavioralSignal | null {
  let type: ExecutionBehavioralSignal['type'] | null = null;
  switch (event.event_type) {
    case 'ActivityCompleted':
    case 'ActivityPartiallyCompleted':
    case 'ActivityMissed':
      type = 'EXECUTION_OUTCOME';
      break;
    case 'DeviationDetected':
    case 'DeviationLogged':
    case 'ActivitySkipped':
      type = 'EXECUTION_DEVIATION';
      break;
    case 'FallbackTriggered':
    case 'FallbackCompleted':
      type = 'RECOVERY_BEHAVIOR';
      break;
    case 'OverrideCreated':
    case 'OverrideGranted':
      type = 'MANUAL_OVERRIDE';
      break;
    case 'PerformanceSessionClosed':
    case 'PerformanceOutcomeEvaluated':
      type = 'PERFORMANCE_OUTCOME';
      break;
    case 'ScheduleProposalCreated':
      type = 'SCHEDULE_PRESSURE';
      break;
    default:
      return null;
  }

  return {
    id: `${event.event_id}:behavior`,
    subjectId: state?.subjectId,
    type,
    occurredAtUtc: event.occurred_at,
    sourceEventId: event.event_id,
    evidence: {
      eventType: event.event_type,
      subject: event.subject,
      payload: event.payload,
      correlationId: event.correlation_id,
      causationId: event.causation_id,
    },
    provenance: {
      source: 'ExecutionOS',
      schemaVersion: '1.0',
    },
  };
}

export function recordBehavioralSignal(state: AppState, signal: ExecutionBehavioralSignal): AppState {
  const existing = (state.executionBehavioralSignals || []).filter(item => item.id !== signal.id);
  return {
    ...state,
    executionBehavioralSignals: [signal, ...existing].slice(0, 500),
  };
}
