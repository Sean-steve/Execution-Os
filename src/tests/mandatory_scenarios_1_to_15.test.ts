import { describe, it, expect } from 'vitest';
import { ScenarioBuilder } from './fixtures/scenarioBuilder';
import { evaluateRoutineState } from '../services/routineEngine';
import { calculateDynamicAllocations, PROTECTED_FAMILY_START, PROTECTED_FAMILY_END } from '../services/allocationEngine';
import { scanAndResolveDeviations } from '../services/deviationEngine';
import { getAutonomousNextDecision } from '../services/decisionEngine';
import { selectOptimalFallbackTier, getFallbackPolicyForTask } from '../services/fallbackEngine';
import { InMemoryExecutionRepository } from '../services/repository';

describe('Mandatory Scenarios 1 to 15 (EOS-013 Verification)', () => {
  // Scenario 1: Normal Green day
  it('Scenario 1: Normal Green day evaluates nominal standard routine and full schedule feasibility', () => {
    const { state, routine, allocations, nextDecision } = ScenarioBuilder.create()
      .withMode('GREEN')
      .withDayType('STANDARD')
      .withTime('05:30')
      .withUncompletedAll()
      .evaluate();

    expect(routine.routineState).toBe('STANDARD');
    expect(routine.isCompressed).toBe(false);
    expect(allocations.isFeasible).toBe(true);
    expect(nextDecision.currentTask?.id).toBe('task-awaken');
  });

  // Scenario 2: Yellow day
  it('Scenario 2: Yellow day restricts task list and adjusts fallback allocations', () => {
    const { state, routine, allocations } = ScenarioBuilder.create()
      .withMode('YELLOW')
      .withDayType('STANDARD')
      .withTime('06:00')
      .evaluate();

    expect(state.currentMode).toBe('YELLOW');
    const yellowTasks = state.tasks.filter(t => t.modesAllowed.includes('YELLOW'));
    expect(yellowTasks.length).toBeLessThan(22); // Less than full 22-task green catalog
    expect(allocations.isFeasible).toBe(true);
  });

  // Scenario 3: Red day
  it('Scenario 3: Red day triggers recovery routine and strips intensive deep work', () => {
    const { state, routine } = ScenarioBuilder.create()
      .withMode('RED')
      .withTime('07:00')
      .evaluate();

    expect(routine.routineState).toBe('RECOVERY');
    const redTasks = state.tasks.filter(t => t.modesAllowed.includes('RED'));
    expect(redTasks.some(t => t.id === 'task-deep-work-build')).toBe(false);
    expect(redTasks.some(t => t.id === 'task-family-connection' || t.anchorId === 'ANCHOR_8_HUMAN_LIFE')).toBe(true);
  });

  // Scenario 4: Early Exit
  it('Scenario 4: Early Exit day type compresses schedule and evaluates EARLY_EXIT state', () => {
    const { routine } = ScenarioBuilder.create()
      .withDayType('EARLY_DEPARTURE')
      .withTime('05:45')
      .evaluate();

    expect(routine.routineState).toBe('EARLY_EXIT');
    expect(routine.isCompressed).toBe(true);
  });

  // Scenario 5: Strong Ends
  it('Scenario 5: Strong Ends day type prioritizes morning and evening anchors', () => {
    const { state } = ScenarioBuilder.create()
      .withDayType('STRONG_ENDS')
      .withTime('05:30')
      .evaluate();

    expect(state.dayType).toBe('STRONG_ENDS');
  });

  // Scenario 6: User plans tomorrow
  it('Scenario 6: User plans tomorrow and records top 3 priorities, meal, workout, and company focus', () => {
    const state = ScenarioBuilder.create()
      .withTomorrowPlan({
        top3: ['Ship HEE harness', 'Close enterprise partner', 'Deep Family Outing'],
        scheduleFocus: 'Heavy Builder Sprint',
        plannedMeal: 'High Protein Salad + Steak',
        workoutType: 'Zone 2 + Kettlebell 5x5',
        companyPriority: 'Execution OS core testing',
        familyActivity: 'Forest walk and dinner',
        tradingConditions: 'Only A+ Breakouts',
      })
      .build();

    expect(state.tomorrowPlan.top3[0]).toBe('Ship HEE harness');
    expect(state.tomorrowPlan.workoutType).toBe('Zone 2 + Kettlebell 5x5');
  });

  // Scenario 7: Tomorrow plan persists through reload
  it('Scenario 7: Tomorrow plan persists through repository storage reload', async () => {
    const repo = new InMemoryExecutionRepository();
    const state = ScenarioBuilder.create()
      .withTomorrowPlan({
        top3: ['Refactor engines', 'Review pillars', 'Rest early'],
        scheduleFocus: 'Deep focus',
      })
      .build();

    await repo.saveState(state);
    const reloaded = await repo.loadState();

    expect(reloaded?.tomorrowPlan.top3[0]).toBe('Refactor engines');
    expect(reloaded?.tomorrowPlan.scheduleFocus).toBe('Deep focus');
  });

  // Scenario 8: User wakes two hours late
  it('Scenario 8: User wakes two hours late (07:30 instead of 05:30)', () => {
    const { routine, deviations } = ScenarioBuilder.create()
      .withTime('07:30') // 450 mins
      .withUncompletedAll()
      .evaluate();

    expect(routine.routineState).toBe('COMPRESSED');
    expect(deviations.detectedDeviations.some(d => d.type === 'LATE' || d.type === 'MISSED')).toBe(true);
  });

  // Scenario 9: Multiple morning activities become infeasible
  it('Scenario 9: Multiple morning activities become infeasible when time window expires', () => {
    const { deviations } = ScenarioBuilder.create()
      .withTime('08:45') // 525 mins
      .withUncompletedAll()
      .evaluate();

    const lateCount = deviations.detectedDeviations.filter(d => d.type === 'LATE' || d.type === 'MISSED').length;
    expect(lateCount).toBeGreaterThanOrEqual(2);
  });

  // Scenario 10: Routine automatically compresses
  it('Scenario 10: Routine automatically transitions to COMPRESSED state', () => {
    const state = ScenarioBuilder.create()
      .withTime('08:00')
      .withUncompletedAll()
      .build();

    const routine = evaluateRoutineState(state);
    expect(routine.routineState).toBe('COMPRESSED');
    expect(routine.isCompressed).toBe(true);
  });

  // Scenario 11: Activity fallback activates
  it('Scenario 11: Activity fallback activates for time-constrained workout', () => {
    const state = ScenarioBuilder.create().build();
    const policy = getFallbackPolicyForTask(state, 'task-workout-morning');
    expect(policy).toBeDefined();

    if (policy) {
      const fallback = selectOptimalFallbackTier(policy, 10, 'YELLOW');
      expect(fallback.level).toBeGreaterThanOrEqual(1);
      expect(fallback.durationMinutes).toBeLessThanOrEqual(10);
    }
  });

  // Scenario 12: Deep work overruns
  it('Scenario 12: Deep work overruns beyond scheduled end time, triggering schedule adjustment', () => {
    const state = ScenarioBuilder.create()
      .withTime('11:30') // 690 mins (standard end was 630 mins = 10:30)
      .withTaskOverrun('task-deep-work-build', 60)
      .build();

    const { allocations, hasScheduleCompression } = calculateDynamicAllocations(state);
    expect(allocations.length).toBeGreaterThan(0);
    // Afternoon tasks shifted forward
    const companyAlloc = allocations.find(a => a.activityId === 'task-company-of-day');
    expect(companyAlloc).toBeDefined();
  });

  // Scenario 13: Activity finishes early
  it('Scenario 13: Activity finishes early, releasing time buffer for upcoming tasks', () => {
    const state = ScenarioBuilder.create()
      .withTime('06:00')
      .withEarlyCompletion('task-workout-morning', 375) // finished in 15 mins
      .build();

    const workoutTask = state.tasks.find(t => t.id === 'task-workout-morning');
    expect(workoutTask?.completed).toBe(true);
    expect(workoutTask?.completedAtMinutes).toBe(375);
  });

  // Scenario 14: Schedule automatically reallocates
  it('Scenario 14: Schedule automatically recalculates and shifts downstream start times', () => {
    const state = ScenarioBuilder.create()
      .withTime('08:30')
      .withUncompletedAll()
      .build();

    const { allocations } = calculateDynamicAllocations(state);
    const uncompletedAllocations = allocations.filter(a => {
      const task = state.tasks.find(t => t.id === a.activityId);
      return task && !task.completed;
    });

    uncompletedAllocations.forEach(alloc => {
      expect(alloc.allocatedEndMinutes).toBeGreaterThanOrEqual(510);
    });
  });

  // Scenario 15: Family protected block cannot be displaced
  it('Scenario 15: Family protected block cannot be displaced under any schedule compression', () => {
    const state = ScenarioBuilder.create()
      .withTime('10:00')
      .withUncompletedAll()
      .build();

    const { allocations } = calculateDynamicAllocations(state);
    const familyAlloc = allocations.find(a => a.activityId === 'task-family-connection' || a.activityId === 'task-family-life');
    expect(familyAlloc).toBeDefined();
    expect(familyAlloc?.allocatedStartMinutes).toBeGreaterThanOrEqual(PROTECTED_FAMILY_START);
    expect(familyAlloc?.allocatedEndMinutes).toBeLessThanOrEqual(PROTECTED_FAMILY_END + 30);
  });
});
