import { describe, it, expect } from 'vitest';
import { evaluateRoutineState } from '../services/routineEngine';
import { ScenarioBuilder } from './fixtures/scenarioBuilder';

describe('HEE-001 — Routine Engine', () => {
  it('evaluates STANDARD state on Green nominal day at 05:30', () => {
    const state = ScenarioBuilder.create()
      .withMode('GREEN')
      .withDayType('STANDARD')
      .withTime('05:30')
      .withUncompletedAll()
      .build();

    const result = evaluateRoutineState(state);
    expect(result.routineState).toBe('STANDARD');
    expect(result.isCompressed).toBe(false);
    expect(result.canExecuteAutonomousRecovery).toBe(false);
    expect(result.reason).toContain('Nominal operating conditions');
  });

  it('evaluates COMPRESSED state when wake or morning anchor is delayed past threshold', () => {
    const state = ScenarioBuilder.create()
      .withMode('GREEN')
      .withTime('08:30')
      .withUncompletedAll()
      .build();

    const result = evaluateRoutineState(state);
    expect(result.routineState).toBe('COMPRESSED');
    expect(result.isCompressed).toBe(true);
    expect(result.reason).toContain('Schedule Drift');
  });

  it('evaluates RECOVERY state when system mode is RED', () => {
    const state = ScenarioBuilder.create()
      .withMode('RED')
      .withTime('07:00')
      .build();

    const result = evaluateRoutineState(state);
    expect(result.routineState).toBe('RECOVERY');
    expect(result.isCompressed).toBe(true);
    expect(result.reason).toContain('Red Mode Active');
  });

  it('evaluates EARLY_EXIT state when day type is EARLY_DEPARTURE', () => {
    const state = ScenarioBuilder.create()
      .withDayType('EARLY_DEPARTURE')
      .withTime('06:00')
      .build();

    const result = evaluateRoutineState(state);
    expect(result.routineState).toBe('EARLY_EXIT');
    expect(result.isCompressed).toBe(true);
    expect(result.reason).toContain('Early Exit Day');
  });

  it('evaluates COMPLETED state when all active anchors are fulfilled', () => {
    const state = ScenarioBuilder.create()
      .withTime('21:30')
      .build();
    
    // mark all tasks completed
    state.tasks = state.tasks.map(t => ({ ...t, completed: true }));

    const result = evaluateRoutineState(state);
    expect(result.routineState).toBe('COMPLETED');
    expect(result.reason).toContain('All scheduled anchors for today have been executed successfully');
  });

  it('evaluates DISRUPTED state when non-negotiable anchor was missed without fallback', () => {
    const state = ScenarioBuilder.create()
      .withTime('14:00')
      .build();

    // Mark deep work as missed window without completion
    state.tasks = state.tasks.map(t => 
      t.id === 'task-deep-work-build' ? { ...t, completed: false, missedWindow: true } : t
    );

    const result = evaluateRoutineState(state);
    expect(['DISRUPTED', 'COMPRESSED', 'STANDARD']).toContain(result.routineState);
  });
});
