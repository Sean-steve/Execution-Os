import { describe, it, expect } from 'vitest';
import { computeExecutionAnalytics } from '../services/analyticsService';
import { ScenarioBuilder } from './fixtures/scenarioBuilder';

describe('HEE-007 — Execution Monitor & Real-Time Analytics', () => {
  it('computes nominal 100% on-time baseline when completed tasks executed on schedule', () => {
    const state = ScenarioBuilder.create()
      .withCompletedTasks(['task-awaken', 'task-outside-light'])
      .build();

    // mark completed tasks with ON_TIME status
    state.tasks = state.tasks.map(t => 
      t.completed ? { ...t, executionStatus: 'ON_TIME' } : t
    );

    const analytics = computeExecutionAnalytics(state);
    expect(analytics.onTimeRate).toBe(100);
    expect(analytics.completionRate).toBeGreaterThan(0);
  });

  it('computes fallback rate and autonomous resolution rate when fallbacks are used', () => {
    const state = ScenarioBuilder.create()
      .withCompletedTasks(['task-workout-morning'])
      .build();

    state.tasks = state.tasks.map(t =>
      t.id === 'task-workout-morning' ? { ...t, fallbackLevel: 1, executionStatus: 'COMPRESSED' } : t
    );

    state.deviations = [
      {
        id: 'dev-1',
        timestamp: new Date().toISOString(),
        activityId: 'task-workout-morning',
        type: 'LATE',
        severity: 'MEDIUM',
        likelyCause: 'Late wake',
        impactSummary: 'Compressed to 10m',
        isResolved: true,
        resolvedAutonomously: true,
      },
    ];

    const analytics = computeExecutionAnalytics(state);
    expect(analytics.fallbackRate).toBeGreaterThan(0);
    expect(analytics.autonomousResolutionRate).toBe(100);
  });

  it('tracks intervention and user override rates in state analytics', () => {
    const state = ScenarioBuilder.create().build();
    state.interventions = [
      {
        id: 'int-1',
        timestamp: new Date().toISOString(),
        deviationId: 'dev-1',
        actionTaken: 'REALLOCATE',
        description: 'Auto-reallocated downstream builder blocks',
        resultStatus: 'SUCCESS',
        humanApprovalRequired: false,
      },
    ];
    state.userOverrides = [
      {
        id: 'ovr-1',
        timestamp: new Date().toISOString(),
        activityId: 'task-deep-work-build',
        overrideType: 'ADVANCE',
        reason: 'Client call concluded early',
        previousState: {},
        newState: {},
      },
    ];

    const analytics = computeExecutionAnalytics(state);
    expect(analytics.interventionRate).toBeGreaterThan(0);
    expect(analytics.overrideRate).toBeGreaterThan(0);
  });
});
