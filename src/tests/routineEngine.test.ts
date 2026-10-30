import { describe, it, expect } from 'vitest';
import { evaluateRoutineState } from '../services/routineEngine';
import { DEFAULT_APP_STATE } from '../data/defaultData';
import { AppState } from '../types';

describe('HEE-001 — Routine Engine', () => {
  it('should evaluate STANDARD routine state under nominal conditions at start of day', () => {
    const state: AppState = {
      ...DEFAULT_APP_STATE,
      dayType: 'STANDARD',
      currentMode: 'GREEN',
      isSimulatedTime: true,
      simulatedTime: '05:30',
      tasks: DEFAULT_APP_STATE.tasks.map(t => ({ ...t, completed: false })),
    };
    const result = evaluateRoutineState(state);
    expect(result.routineState).toBe('STANDARD');
    expect(result.reason).toBeDefined();
    expect(result.isCompressed).toBe(false);
  });

  it('should evaluate COMPRESSED state when significant schedule drift occurs in morning', () => {
    const state: AppState = {
      ...DEFAULT_APP_STATE,
      currentMode: 'GREEN',
      isSimulatedTime: true,
      simulatedTime: '08:30', // 510 mins (past morning anchors)
      tasks: DEFAULT_APP_STATE.tasks.map(t =>
        t.startMinutes < 480 ? { ...t, completed: false } : t
      ),
    };
    const result = evaluateRoutineState(state);
    expect(result.routineState).toBe('COMPRESSED');
    expect(result.isCompressed).toBe(true);
    expect(result.canExecuteAutonomousRecovery).toBe(true);
  });

  it('should evaluate RECOVERY state in RED mode', () => {
    const state: AppState = {
      ...DEFAULT_APP_STATE,
      currentMode: 'RED',
      isSimulatedTime: true,
      simulatedTime: '07:00',
    };
    const result = evaluateRoutineState(state);
    expect(result.routineState).toBe('RECOVERY');
    expect(result.isCompressed).toBe(true);
  });

  it('should evaluate EARLY_EXIT state when early departure day type is active', () => {
    const state: AppState = {
      ...DEFAULT_APP_STATE,
      dayType: 'EARLY_DEPARTURE',
      isSimulatedTime: true,
      simulatedTime: '05:30',
    };
    const result = evaluateRoutineState(state);
    expect(result.routineState).toBe('EARLY_EXIT');
    expect(result.isCompressed).toBe(true);
  });

  it('should evaluate COMPLETED state when all allowed anchors are finished', () => {
    const state: AppState = {
      ...DEFAULT_APP_STATE,
      currentMode: 'GREEN',
      isSimulatedTime: true,
      simulatedTime: '21:00',
      tasks: DEFAULT_APP_STATE.tasks.map(t => ({ ...t, completed: true })),
    };
    const result = evaluateRoutineState(state);
    expect(result.routineState).toBe('COMPLETED');
  });
});
