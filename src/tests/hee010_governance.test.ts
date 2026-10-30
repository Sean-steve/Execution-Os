import { describe, it, expect } from 'vitest';
import { logEventToState } from '../services/eventBus';
import { ScenarioBuilder, verifyEventCorrelationChain } from './fixtures/scenarioBuilder';
import { UserOverrideRecord } from '../types';

describe('HEE-010 — Governance & Autonomy Guardrails', () => {
  it('supports full spectrum of Autonomy Levels (Level 0 through Level 5)', () => {
    const l0 = ScenarioBuilder.create().withAutonomyLevel(0).build();
    const l3 = ScenarioBuilder.create().withAutonomyLevel(3).build();
    const l5 = ScenarioBuilder.create().withAutonomyLevel(5).build();

    expect(l0.autonomyLevel).toBe(0);
    expect(l3.autonomyLevel).toBe(3);
    expect(l5.autonomyLevel).toBe(5);
  });

  it('records structured UserOverrideRecord with before/after state and explicit reason', () => {
    let state = ScenarioBuilder.create().build();

    const override: UserOverrideRecord = {
      id: 'ovr-test-1',
      timestamp: new Date().toISOString(),
      activityId: 'task-deep-work-build',
      overrideType: 'ADVANCE',
      reason: 'Urgent client launch requirement',
      previousState: { allocatedStartMinutes: 480 },
      newState: { allocatedStartMinutes: 420 },
    };

    state = {
      ...state,
      userOverrides: [...(state.userOverrides || []), override],
    };

    state = logEventToState(
      state,
      'OverrideCreated',
      `Manual Override Applied: ${override.overrideType} on ${override.activityId}`,
      { override },
      'USER'
    );

    expect(state.userOverrides.length).toBeGreaterThan(0);
    expect(state.userOverrides[0].reason).toBe('Urgent client launch requirement');
    expect(state.events.some(e => e.event_type === 'OverrideCreated')).toBe(true);
    expect(verifyEventCorrelationChain(state.events)).toBe(true);
  });

  it('preserves governance event correlation chains without missing actor or timestamps', () => {
    let state = ScenarioBuilder.create().build();

    state = logEventToState(state, 'RoutineActivated', 'Routine initialized', {}, 'SYSTEM_KERNEL');
    state = logEventToState(state, 'ActivityStarted', 'Started Awakening Anchor', { taskId: 'task-awaken' }, 'USER');
    state = logEventToState(state, 'DeviationDetected', 'Late wake detected', { minutesLate: 30 }, 'SYSTEM_KERNEL');

    expect(state.events.length).toBeGreaterThanOrEqual(3);
    expect(verifyEventCorrelationChain(state.events)).toBe(true);
  });
});
