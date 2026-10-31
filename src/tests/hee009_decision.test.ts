import { describe, it, expect } from 'vitest';
import { getAutonomousNextDecision } from '../services/decisionEngine';
import { ScenarioBuilder } from './fixtures/scenarioBuilder';

describe('HEE-009 — Decision Intelligence & Candidate Ranking', () => {
  it('selects sovereign awakening at 05:30 with clear contextual reasoning', () => {
    const state = ScenarioBuilder.create()
      .withTime('05:30')
      .withUncompletedAll()
      .build();

    const decision = getAutonomousNextDecision(state);
    expect(decision.currentTask).toBeDefined();
    expect(decision.currentTask?.id).toBe('task-awaken');
    expect(decision.decisionReason).toMatch(/highest-priority|authorized|protected|feasible/i);
    expect(decision.isProtected).toBe(false);
  });

  it('selects Deep Work builder block after morning routine completion with time budget to family window', () => {
    const state = ScenarioBuilder.create()
      .withTime('09:00')
      .withCompletedTasks([
        'task-awaken',
        'task-dream-journal',
        'task-outside-light',
        'task-workout-morning',
        'task-shower-morning',
        'task-meditation',
        'task-command-center',
        'task-breakfast',
      ])
      .build();

    const decision = getAutonomousNextDecision(state);
    expect(decision.currentTask).toBeDefined();
    expect(decision.currentTask?.id).toBe('task-deep-work-build');
    expect(decision.isBlockedByDependency).toBe(false);
    expect(decision.decisionReason).toMatch(/highest-priority|authorized|feasible|active/i);
  });

  it('signals protected status and family priority during 16:00 - 19:30 window', () => {
    const state = ScenarioBuilder.create()
      .withTime('16:30')
      .withCompletedTasks([
        'task-awaken',
        'task-dream-journal',
        'task-outside-light',
        'task-workout-morning',
        'task-shower-morning',
        'task-meditation',
        'task-command-center',
        'task-breakfast',
        'task-deep-work-build',
        'task-trading-protocol',
        'task-operational-buffer',
        'task-lunch',
        'task-company-of-day',
        'task-admin-transition',
        'task-afternoon-workout',
      ])
      .build();

    const decision = getAutonomousNextDecision(state);
    expect(decision.currentTask).toBeDefined();
    expect(decision.currentTask?.id).toBe('task-family-connection');
    expect(decision.isProtected).toBe(true);
    expect(decision.decisionReason).toContain('protected commitment');
  });

  it('returns graceful completion status when all anchors are completed', () => {
    const state = ScenarioBuilder.create()
      .withTime('22:00')
      .build();

    state.tasks = state.tasks.map(t => ({ ...t, completed: true }));

    const decision = getAutonomousNextDecision(state);
    expect(decision.currentTask).toBeNull();
    expect(decision.decisionReason).toContain('complete');
  });
});
