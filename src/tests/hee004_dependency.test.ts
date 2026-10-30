import { describe, it, expect } from 'vitest';
import { checkTaskDependencies } from '../services/dependencyEngine';
import { ScenarioBuilder } from './fixtures/scenarioBuilder';

describe('HEE-004 — Dependency Engine & Execution Prerequisites', () => {
  it('blocks downstream deep work when Command Center Daily Victory is uncompleted', () => {
    const state = ScenarioBuilder.create()
      .withUncompletedAll()
      .build();

    const depCheck = checkTaskDependencies(state, 'task-deep-work-build');
    expect(depCheck.isBlocked).toBe(true);
    expect(depCheck.isSatisfied).toBe(false);
    expect(depCheck.blockingReasons.some(r => r.includes('Command Center'))).toBe(true);
  });

  it('unblocks deep work once Command Center is marked completed', () => {
    const state = ScenarioBuilder.create()
      .withCompletedTasks(['task-command-center'])
      .build();

    const depCheck = checkTaskDependencies(state, 'task-deep-work-build');
    expect(depCheck.isBlocked).toBe(false);
    expect(depCheck.isSatisfied).toBe(true);
    expect(depCheck.blockingReasons.length).toBe(0);
  });

  it('blocks trading execution when Market Analysis has not been completed', () => {
    const state = ScenarioBuilder.create()
      .withTrading({
        isTradingDay: true,
        marketAnalyzed: false,
        setupDetected: false,
      })
      .build();

    const depCheck = checkTaskDependencies(state, 'task-trading-execution');
    expect(depCheck.isBlocked).toBe(true);
    expect(depCheck.blockingReasons.some(r => r.includes('Market Analysis'))).toBe(true);
  });

  it('blocks trading execution when No Setup is detected and noSetupJustified is false', () => {
    const state = ScenarioBuilder.create()
      .withTrading({
        isTradingDay: true,
        marketAnalyzed: true,
        setupDetected: false,
        noSetupJustified: false,
      })
      .build();

    const depCheck = checkTaskDependencies(state, 'task-trading-execution');
    expect(depCheck.isBlocked).toBe(true);
    expect(depCheck.blockingReasons.some(r => r.includes('No-Setup hard rule'))).toBe(true);
  });

  it('permits trading execution when Market Analysis is done and valid A+ Setup is detected', () => {
    const state = ScenarioBuilder.create()
      .withCompletedTasks(['task-trading-protocol'])
      .withTrading({
        isTradingDay: true,
        marketAnalyzed: true,
        setupDetected: true,
        setupName: 'Key S/R Reversal Breakout',
        strategyCriteriaMet: true,
        riskLimitsSatisfied: true,
        stopLossDefined: true,
      })
      .build();

    const depCheck = checkTaskDependencies(state, 'task-trading-execution');
    expect(depCheck.isBlocked).toBe(false);
    expect(depCheck.isSatisfied).toBe(true);
  });
});
