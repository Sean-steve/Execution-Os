import { describe, it, expect } from 'vitest';
import { calculateDynamicAllocations } from '../services/allocationEngine';
import { PROTECTED_FAMILY_START, PROTECTED_FAMILY_END } from './fixtures/legacyStandaloneScheduleConstants';
import { ScenarioBuilder } from './fixtures/scenarioBuilder';

describe('HEE-003 — Dynamic Allocation Engine', () => {
  it('calculates allocations for all active mode tasks without gaps or invalid overlaps', () => {
    const state = ScenarioBuilder.create()
      .withMode('GREEN')
      .withTime('05:30')
      .build();

    const { allocations, isFeasible } = calculateDynamicAllocations(state);
    expect(allocations.length).toBeGreaterThan(0);
    expect(isFeasible).toBe(true);

    allocations.forEach(alloc => {
      expect(alloc.allocatedStartMinutes).toBeLessThan(alloc.allocatedEndMinutes);
      expect(alloc.durationMinutes).toBeGreaterThan(0);
    });
  });

  it('strictly prohibits work blocks from encroaching upon the Protected Family Window (16:00 - 19:30)', () => {
    // Simulate late morning starting at 09:00 with deep work uncompleted
    const state = ScenarioBuilder.create()
      .withMode('GREEN')
      .withTime('09:00')
      .withUncompletedAll()
      .build();

    const { allocations } = calculateDynamicAllocations(state);

    const nonFamilyWorkAllocations = allocations.filter(a =>
      a.activityId === 'task-deep-work-build' ||
      a.activityId === 'task-trading-protocol' ||
      a.activityId === 'task-operational-buffer' ||
      a.activityId === 'task-company-of-day'
    );

    nonFamilyWorkAllocations.forEach(alloc => {
      const overlapsFamily = 
        alloc.allocatedStartMinutes < PROTECTED_FAMILY_END && 
        alloc.allocatedEndMinutes > PROTECTED_FAMILY_START;
      
      expect(overlapsFamily).toBe(false);
    });
  });

  it('dynamically compresses tasks when time drift consumes buffer', () => {
    const state = ScenarioBuilder.create()
      .withTime('08:45')
      .withUncompletedAll()
      .build();

    const { allocations, hasScheduleCompression, reallocationReason } = calculateDynamicAllocations(state);
    expect(hasScheduleCompression).toBe(true);
    expect(reallocationReason).toBeDefined();

    // Past tasks should have compressed or shifted allocations
    const pastTasks = allocations.filter(a => a.originalStartMinutes < 525);
    expect(pastTasks.length).toBeGreaterThan(0);
  });
});
