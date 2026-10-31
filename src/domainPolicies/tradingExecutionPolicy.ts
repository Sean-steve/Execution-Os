import { AppState } from '../types';
import { DomainExecutionPolicy, domainExecutionPolicies } from './domainExecutionPolicy';

const isTradingActivity = (state: AppState, taskId: string) => {
  const task = state.tasks.find(t => t.id === taskId);
  const def = state.activities.find(a => a.id === taskId);
  return task?.interactiveActionType === 'TRADING_GATEKEEPER' ||
    def?.interactiveActionType === 'TRADING_GATEKEEPER' ||
    taskId === 'task-trading-execution' ||
    taskId === 'task-trading-protocol';
};

export const tradingExecutionPolicy: DomainExecutionPolicy = {
  id: 'domain.trading.execution-gate',
  appliesTo: isTradingActivity,

  evaluateStart(state, taskId) {
    const p = state.tradingProtocol;
    if (!p?.isTradingDay) return { blocked: false, reasons: [] };

    const reasons: string[] = [];
    const blockingTaskIds: string[] = [];

    if (taskId === 'task-trading-execution') {
      if (!p.marketAnalyzed && !p.preMarketAnalysisDone) {
        reasons.push('Market analysis must be finalized before trading execution.');
        blockingTaskIds.push('task-trading-protocol');
      }
      if (!p.setupDetected && !p.noSetupJustified) {
        reasons.push('Trade execution requires a validated setup; No Setup must terminate as No Trade.');
        blockingTaskIds.push('task-trading-protocol');
      }
      if (p.setupDetected && (!p.strategyCriteriaMet || !p.riskLimitsSatisfied || !p.stopLossDefined)) {
        reasons.push('Validated setup, strategy criteria, risk limits, and stop-loss are required before execution.');
        blockingTaskIds.push('task-trading-protocol');
      }
    }

    return {
      blocked: reasons.length > 0,
      reasons,
      blockingTaskIds,
      errorCode: 'TRADING_GATE_CLOSED',
      rule: 'DOMAIN_TRADING_EXECUTION_GATE',
    };
  },

  evaluateCompletion(state, taskId) {
    const p = state.tradingProtocol;
    if (!p?.isTradingDay) return { blocked: false, reasons: [] };

    if (taskId === 'task-trading-protocol') {
      const noTrade = p.marketAnalyzed && p.closedTerminal && p.noSetupJustified && !p.executed;
      const setupReady = p.marketAnalyzed && p.setupDetected && p.strategyCriteriaMet && p.riskLimitsSatisfied && p.stopLossDefined;
      return {
        blocked: !noTrade && !setupReady,
        reasons: !noTrade && !setupReady ? ['Trading preparation has not reached a valid setup or disciplined No Trade outcome.'] : [],
        errorCode: 'TRADING_GATE_CLOSED',
        rule: 'DOMAIN_TRADING_PREP_COMPLETION_GATE',
      };
    }

    if (taskId === 'task-trading-execution') {
      const executed = p.marketAnalyzed && p.setupDetected && p.strategyCriteriaMet &&
        p.riskLimitsSatisfied && p.stopLossDefined && p.executed && p.closedTerminal;
      return {
        blocked: !executed,
        reasons: !executed ? ['Trading execution has not reached a valid executed terminal outcome.'] : [],
        errorCode: 'TRADING_GATE_CLOSED',
        rule: 'DOMAIN_TRADING_EXECUTION_COMPLETION_GATE',
      };
    }

    return { blocked: false, reasons: [] };
  },
};

domainExecutionPolicies.register(tradingExecutionPolicy);
