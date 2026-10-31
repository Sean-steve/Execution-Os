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

  const executionEligible =
    protocol.isTradingDay &&
    protocol.marketAnalyzed &&
    protocol.setupDetected &&
    protocol.strategyCriteriaMet &&
    protocol.riskLimitsSatisfied &&
    protocol.stopLossDefined;

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
        : 'External domain gate has not authorized execution.',
    evaluatedAtUtc: new Date().toISOString(),
    version: 1,
  });

  return next;
}
