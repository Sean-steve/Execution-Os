import { describe, it, expect } from 'vitest';
import { getAutonomousNextDecision } from '../services/decisionEngine';
import { evaluateRoutineState } from '../services/routineEngine';
import { calculateDynamicAllocations } from '../services/allocationEngine';
import { PROTECTED_FAMILY_START, PROTECTED_FAMILY_END } from './fixtures/legacyStandaloneScheduleConstants';
import { DEFAULT_APP_STATE } from '../data/defaultData';
import { AppState } from '../types';

describe('HEE-009 & EOS-013 — Golden Acceptance Scenario & Decision Intelligence', () => {
  it('should select contextually appropriate next action at 6:00 AM on a nominal day', () => {
    const state: AppState = {
      ...DEFAULT_APP_STATE,
      isSimulatedTime: true,
      simulatedTime: '06:00',
    };
    const decision = getAutonomousNextDecision(state);
    expect(decision.currentTask).toBeDefined();
    expect(decision.decisionReason).toBeDefined();
    expect(decision.decisionReason.length).toBeGreaterThan(10);
  });

  it('GOLDEN ACCEPTANCE SCENARIO: User wakes late at 8:00 AM', () => {
    // 1. Initial state: wake late at 8:00 AM (480 mins)
    const lateWakeState: AppState = {
      ...DEFAULT_APP_STATE,
      isSimulatedTime: true,
      simulatedTime: '08:00',
      tasks: DEFAULT_APP_STATE.tasks.map(t =>
        t.startMinutes < 480 ? { ...t, completed: false } : t
      ),
    };

    // 2. Routine Engine evaluates state and transitions to COMPRESSED
    const routineEval = evaluateRoutineState(lateWakeState);
    expect(routineEval.routineState).toBe('COMPRESSED');
    expect(routineEval.isCompressed).toBe(true);

    // 3. Allocation engine recalculates remaining day without violating family block
    const { allocations, isFeasible, hasScheduleCompression } = calculateDynamicAllocations(lateWakeState);
    expect(allocations.length).toBeGreaterThan(0);
    expect(isFeasible).toBe(true);
    expect(hasScheduleCompression).toBe(true);

    // Verify non-family work allocations never encroach on family window (960 to 1170)
    const workAllocations = allocations.filter(a => 
      a.activityId === 'task-deep-work-build' || 
      a.activityId === 'task-trading-protocol' || 
      a.activityId === 'task-operational-buffer' || 
      a.activityId === 'task-company-target'
    );

    workAllocations.forEach(alloc => {
      const overlapsFamily = alloc.allocatedStartMinutes < PROTECTED_FAMILY_END && alloc.allocatedEndMinutes > PROTECTED_FAMILY_START;
      expect(overlapsFamily).toBe(false);
    });

    // 4. Decision Engine surfaces the immediate next executable action with reason
    const nextDecision = getAutonomousNextDecision(lateWakeState);
    expect(nextDecision.currentTask).toBeDefined();
    expect(nextDecision.currentTask?.title).toContain('Identity');
    expect(nextDecision.decisionReason).toBeDefined();
    expect(nextDecision.decisionReason).toContain('sovereign identity reset');
  });
});
