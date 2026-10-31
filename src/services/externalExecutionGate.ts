import { AppState, ExternalExecutionGate, ExternalGateStatus } from '../types';

export interface ExternalGateEvaluation {
  isBlocked: boolean;
  blockingReasons: string[];
  gateIds: string[];
}

export function evaluateExternalExecutionGates(
  state: AppState,
  activityId: string
): ExternalGateEvaluation {
  const now = Date.now();
  const gates = (state.externalExecutionGates || []).filter(gate => {
    if (gate.targetActivityId !== activityId) return false;
    if (!gate.expiresAtUtc) return true;
    return new Date(gate.expiresAtUtc).getTime() > now;
  });

  const blocking = gates.filter(gate => gate.status === 'CLOSED' || gate.status === 'BLOCKED');

  return {
    isBlocked: blocking.length > 0,
    blockingReasons: blocking.map(gate =>
      gate.reason || `External execution gate ${gate.id} from ${gate.sourceEngine} is ${gate.status}.`
    ),
    gateIds: blocking.map(gate => gate.id),
  };
}

export function upsertExternalExecutionGate(
  state: AppState,
  gate: ExternalExecutionGate
): AppState {
  const existing = state.externalExecutionGates || [];
  return {
    ...state,
    externalExecutionGates: [
      ...existing.filter(item => item.id !== gate.id),
      { ...gate, evaluatedAtUtc: gate.evaluatedAtUtc || new Date().toISOString() },
    ],
  };
}

export function makeExternalExecutionGate(input: {
  id: string;
  sourceEngine: string;
  targetActivityId: string;
  status: ExternalGateStatus;
  reason?: string;
  capability?: string;
  evidenceRef?: string;
  expiresAtUtc?: string;
}): ExternalExecutionGate {
  return {
    ...input,
    evaluatedAtUtc: new Date().toISOString(),
    version: 1,
  };
}
