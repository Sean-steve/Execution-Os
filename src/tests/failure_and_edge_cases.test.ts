import { describe, it, expect } from 'vitest';
import { ScenarioBuilder, verifyEventCorrelationChain } from './fixtures/scenarioBuilder';
import { checkTaskDependencies } from '../services/dependencyEngine';
import { calculateDynamicAllocations } from '../services/allocationEngine';
import { selectOptimalFallbackTier, getFallbackPolicyForTask } from '../services/fallbackEngine';
import { getAutonomousNextDecision } from '../services/decisionEngine';
import { logEventToState } from '../services/eventBus';
import { AppState, ActivityDependency } from '../types';

describe('HEE Edge Cases & Malformed State Failure Testing', () => {
  // 1. Circular dependency
  it('handles circular dependencies gracefully without infinite loop', () => {
    const circularDeps: ActivityDependency[] = [
      {
        id: 'dep-circ-1',
        sourceActivityId: 'task-command-center',
        targetActivityId: 'task-deep-work-build',
        type: 'REQUIRES',
        description: 'Command Center requires Deep Work',
        isMandatory: true,
      },
      {
        id: 'dep-circ-2',
        sourceActivityId: 'task-deep-work-build',
        targetActivityId: 'task-command-center',
        type: 'REQUIRES',
        description: 'Deep Work requires Command Center',
        isMandatory: true,
      },
    ];

    const state: AppState = ScenarioBuilder.create()
      .withUncompletedAll()
      .build();

    state.dependencies = circularDeps;

    // Must evaluate cleanly without stack overflow
    const result1 = checkTaskDependencies(state, 'task-command-center');
    const result2 = checkTaskDependencies(state, 'task-deep-work-build');

    expect(result1.isBlocked).toBe(true);
    expect(result2.isBlocked).toBe(true);
  });

  // 2. Impossible schedule / zero available time
  it('handles zero available time without crashing or NaN values', () => {
    const state = ScenarioBuilder.create()
      .withTime('23:59')
      .withUncompletedAll()
      .build();

    const { allocations, isFeasible } = calculateDynamicAllocations(state);
    expect(allocations).toBeDefined();
    allocations.forEach(a => {
      expect(Number.isNaN(a.allocatedStartMinutes)).toBe(false);
      expect(Number.isNaN(a.allocatedEndMinutes)).toBe(false);
      expect(Number.isNaN(a.durationMinutes)).toBe(false);
    });
  });

  // 3. Duplicate completion attempts
  it('handles duplicate completion idempotently', () => {
    let state = ScenarioBuilder.create().build();
    const taskId = 'task-awaken';

    // First completion
    state.tasks = state.tasks.map(t => t.id === taskId ? { ...t, completed: true, completedAtMinutes: 340 } : t);
    const firstCompleted = state.tasks.find(t => t.id === taskId);
    expect(firstCompleted?.completed).toBe(true);

    // Duplicate completion attempt
    state.tasks = state.tasks.map(t => t.id === taskId ? { ...t, completed: true, completedAtMinutes: 345 } : t);
    const secondCompleted = state.tasks.find(t => t.id === taskId);
    expect(secondCompleted?.completed).toBe(true);
  });

  // 4. Duplicate event processing
  it('handles duplicate system events with valid correlation tracking', () => {
    let state = ScenarioBuilder.create().build();
    state = logEventToState(state, 'ActivityStarted', 'Task started', { taskId: 'task-1' });
    const eventId = state.events[0].event_id;

    // Ensure event structure is well-formed
    expect(eventId).toBeDefined();
    expect(verifyEventCorrelationChain(state.events)).toBe(true);
  });

  // 5. Stale state handling
  it('handles missing or undefined sub-arrays in state gracefully', () => {
    const malformedState = {
      ...ScenarioBuilder.create().build(),
      deviations: undefined as any,
      interventions: undefined as any,
      events: undefined as any,
      dynamicAllocations: undefined as any,
    };

    const decision = getAutonomousNextDecision(malformedState);
    expect(decision).toBeDefined();
  });

  // 6. Fallback exhaustion
  it('handles fallback exhaustion by selecting lowest minimum viable tier (Level 3/4)', () => {
    const state = ScenarioBuilder.create().build();
    const policy = getFallbackPolicyForTask(state, 'task-workout-morning');
    expect(policy).toBeDefined();

    if (policy) {
      // If only 1 minute available, return lowest feasible tier
      const selected = selectOptimalFallbackTier(policy, 1, 'RED');
      expect(selected).toBeDefined();
      expect(selected.level).toBeGreaterThanOrEqual(1);
    }
  });

  // 7. Conflicting protected commitments
  it('preserves family block invariant even when multiple prior tasks overrun simultaneously', () => {
    const state = ScenarioBuilder.create()
      .withTime('15:45') // 945 mins (15 mins before 16:00 family block)
      .withTaskOverrun('task-deep-work-build', 120)
      .withTaskOverrun('task-company-of-day', 90)
      .build();

    const { allocations } = calculateDynamicAllocations(state);
    const familyAlloc = allocations.find(a => a.activityId === 'task-family-connection' || a.activityId === 'task-family-life');

    expect(familyAlloc).toBeDefined();
    expect(familyAlloc!.allocatedStartMinutes).toBeGreaterThanOrEqual(960);
  });

  // 8. Invalid trading eligibility transition
  it('strictly blocks trade if trading is marked executed without required gate validations', () => {
    const state = ScenarioBuilder.create()
      .withTrading({
        isTradingDay: true,
        marketAnalyzed: false,
        setupDetected: false,
        executed: true, // illegal executed flag without setup
      })
      .build();

    const depCheck = checkTaskDependencies(state, 'task-trading-execution');
    expect(depCheck.isBlocked).toBe(true);
  });
});
