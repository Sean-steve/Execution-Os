import { AppState, TradingProtocol } from '../types';
import { upsertExternalExecutionGate } from '../services/externalExecutionGate';

const LEGACY_GATE_ID = 'legacy-trading-execution-gate';

/**
 * Compatibility adapter only. Trading policy is NOT owned by Execution OS.
 * It translates the legacy standalone TradingProtocol shape into the generic
 * external execution gate contract that a Trading OS/HOS domain engine will use.
 */
export function applyLegacyTradingProtocolUpdate(
  state: AppState,
  updates: Partial<TradingProtocol>
): AppState {
  const protocol: TradingProtocol = { ...state.tradingProtocol, ...updates };
  let next = { ...state, tradingProtocol: protocol };

  const noTradeTerminal =
    protocol.marketAnalyzed &&
    protocol.closedTerminal &&
    protocol.noSetupJustified &&
    !protocol.executed;

  const legacyPrepCompleted = state.tasks.some(task =>
    task.id === 'task-trading-protocol' && task.completed
  );

  const executionEligible =
    protocol.isTradingDay &&
    protocol.marketAnalyzed &&
    protocol.setupDetected &&
    (
      legacyPrepCompleted ||
      (
        protocol.strategyCriteriaMet &&
        protocol.riskLimitsSatisfied &&
        protocol.stopLossDefined
      )
    );

  const status = noTradeTerminal
    ? 'SATISFIED'
    : executionEligible
      ? 'OPEN'
      : 'BLOCKED';

  next = upsertExternalExecutionGate(next, {
    id: LEGACY_GATE_ID,
    sourceEngine: 'LEGACY_TRADING_COMPATIBILITY_ADAPTER',
    targetActivityId: 'task-trading-execution',
    capability: 'external.execution.authorize',
    status,
    reason: noTradeTerminal
      ? 'External domain reported a disciplined terminal no-action outcome.'
      : executionEligible
        ? 'External domain gate reports execution prerequisites satisfied.'
        : !protocol.marketAnalyzed
          ? 'Market Analysis must be finalized and logged before external execution is permitted.'
          : !protocol.setupDetected && !protocol.noSetupJustified
            ? 'No-Setup hard rule: external execution is forbidden without the required validated setup.'
            : 'External domain risk or prerequisite validation is incomplete.',
    evaluatedAtUtc: new Date().toISOString(),
    version: 1,
  });

  return next;
}
