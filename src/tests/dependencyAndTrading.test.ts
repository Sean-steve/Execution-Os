import { describe, it, expect } from 'vitest';
import { checkTaskDependencies } from '../services/dependencyEngine';
import { DEFAULT_APP_STATE } from '../data/defaultData';
import { AppState } from '../types';

describe('HEE-004 & EOS-009 — Dependency Engine & Trading Gatekeeper', () => {
  it('should block trading execution when Market Analysis is incomplete', () => {
    const state: AppState = {
      ...DEFAULT_APP_STATE,
      tradingProtocol: {
        ...DEFAULT_APP_STATE.tradingProtocol,
        isTradingDay: true,
        marketAnalyzed: false,
        setupDetected: false,
        noSetupJustified: false,
      },
    };

    const result = checkTaskDependencies(state, 'task-trading-execution');
    expect(result.isBlocked).toBe(true);
    expect(result.blockingReasons.some(r => r.includes('Market Analysis'))).toBe(true);
  });

  it('should block trading execution when no setup is detected and noSetupJustified is false', () => {
    const state: AppState = {
      ...DEFAULT_APP_STATE,
      tradingProtocol: {
        ...DEFAULT_APP_STATE.tradingProtocol,
        isTradingDay: true,
        marketAnalyzed: true,
        setupDetected: false,
        noSetupJustified: false,
      },
    };

    const result = checkTaskDependencies(state, 'task-trading-execution');
    expect(result.isBlocked).toBe(true);
    expect(result.blockingReasons.some(r => r.includes('No-Setup hard rule'))).toBe(true);
  });

  it('should permit trade execution once Market Analysis and valid A+ Setup are confirmed', () => {
    const state: AppState = {
      ...DEFAULT_APP_STATE,
      tasks: DEFAULT_APP_STATE.tasks.map(t =>
        t.id === 'task-trading-protocol' ? { ...t, completed: true } : t
      ),
      tradingProtocol: {
        ...DEFAULT_APP_STATE.tradingProtocol,
        isTradingDay: true,
        marketAnalyzed: true,
        setupDetected: true,
        noSetupJustified: false,
      },
    };

    const result = checkTaskDependencies(state, 'task-trading-execution');
    expect(result.isBlocked).toBe(false);
    expect(result.isSatisfied).toBe(true);
  });

  it('should enforce dependency chain between command center and deep work build', () => {
    const state: AppState = {
      ...DEFAULT_APP_STATE,
      tasks: DEFAULT_APP_STATE.tasks.map(t =>
        t.id === 'task-command-center' ? { ...t, completed: false } : t
      ),
    };

    const depCheck = checkTaskDependencies(state, 'task-deep-work-build');
    expect(depCheck.isBlocked).toBe(true);
    expect(depCheck.blockingReasons.some(r => r.includes('Command Center'))).toBe(true);
  });
});
