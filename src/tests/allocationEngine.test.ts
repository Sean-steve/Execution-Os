import { describe, it, expect } from 'vitest';
import { calculateDynamicAllocations, PROTECTED_FAMILY_START, PROTECTED_FAMILY_END } from '../services/allocationEngine';
import { DEFAULT_APP_STATE } from '../data/defaultData';
import { AppState } from '../types';

describe('HEE-003 — Allocation Engine', () => {
  it('should dynamically calculate feasible windows without work encroaching onto protected family block (4:00 PM - 7:30 PM)', () => {
    const state: AppState = {
      ...DEFAULT_APP_STATE,
      isSimulatedTime: true,
      simulatedTime: '05:30',
    };
    const { allocations, isFeasible } = calculateDynamicAllocations(state);
    expect(allocations.length).toBeGreaterThan(0);
    expect(isFeasible).toBe(true);

    // Verify non-family work blocks (deep work, trading, operations, company) do not overlap with family block
    const workAllocations = allocations.filter(a => 
      a.activityId === 'task-deep-work-build' || 
      a.activityId === 'task-trading-protocol' || 
      a.activityId === 'task-operational-buffer' || 
      a.activityId === 'task-company-target'
    );

    workAllocations.forEach(a => {
      const isInsideFamilyWindow = a.allocatedStartMinutes < PROTECTED_FAMILY_END && a.allocatedEndMinutes > PROTECTED_FAMILY_START;
      expect(isInsideFamilyWindow).toBe(false);
    });
  });

  it('should compress and shift allocations forward when late start is detected', () => {
    const state: AppState = {
      ...DEFAULT_APP_STATE,
      isSimulatedTime: true,
      simulatedTime: '08:30', // 510 mins
      tasks: DEFAULT_APP_STATE.tasks.map(t =>
        t.startMinutes < 480 ? { ...t, completed: false } : t
      ),
    };

    const { allocations, hasScheduleCompression, reallocationReason } = calculateDynamicAllocations(state);
    expect(hasScheduleCompression).toBe(true);
    expect(reallocationReason).toContain('Time drift');
    
    // Allocations for remaining tasks should end at or after current clock
    const activeAllocations = allocations.filter(a => {
      const task = state.tasks.find(t => t.id === a.activityId);
      return task && !task.completed;
    });

    activeAllocations.forEach(a => {
      expect(a.allocatedEndMinutes).toBeGreaterThanOrEqual(510);
    });
  });
});
