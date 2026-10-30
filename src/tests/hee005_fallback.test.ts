import { describe, it, expect } from 'vitest';
import { 
  getTaskFallbackTiers, 
  getFallbackPolicyForTask, 
  selectOptimalFallbackTier 
} from '../services/fallbackEngine';
import { ScenarioBuilder } from './fixtures/scenarioBuilder';

describe('HEE-005 — Fallback Engine (Multi-Tier Ladders & MVR)', () => {
  it('provides multi-tier fallbacks (Level 0 through Level 2/3) for core anchors', () => {
    const state = ScenarioBuilder.create().build();

    const morningWorkoutTiers = getTaskFallbackTiers(state, 'task-workout-morning');
    expect(morningWorkoutTiers.length).toBeGreaterThanOrEqual(3);

    const level0 = morningWorkoutTiers.find(t => t.level === 0);
    const level1 = morningWorkoutTiers.find(t => t.level === 1);
    const level2 = morningWorkoutTiers.find(t => t.level === 2);

    expect(level0).toBeDefined();
    expect(level1).toBeDefined();
    expect(level2).toBeDefined();

    expect(level1!.durationMinutes).toBeLessThan(level0!.durationMinutes);
    expect(level2!.durationMinutes).toBeLessThan(level1!.durationMinutes);
  });

  it('selects Level 1 compressed tier when time is constrained under YELLOW mode', () => {
    const state = ScenarioBuilder.create().withMode('YELLOW').build();
    const policy = getFallbackPolicyForTask(state, 'task-workout-morning');
    expect(policy).toBeDefined();

    if (policy) {
      const selected = selectOptimalFallbackTier(policy, 10, 'YELLOW');
      expect(selected.level).toBeGreaterThanOrEqual(1);
      expect(selected.durationMinutes).toBeLessThanOrEqual(10);
      expect(selected.preservesIntentScore).toBeGreaterThanOrEqual(50);
    }
  });

  it('selects Level 2 or 3 minimum viable recovery tier in RED mode', () => {
    const state = ScenarioBuilder.create().withMode('RED').build();
    const policy = getFallbackPolicyForTask(state, 'task-workout-morning');
    expect(policy).toBeDefined();

    if (policy) {
      const selected = selectOptimalFallbackTier(policy, 5, 'RED');
      expect(selected.level).toBeGreaterThanOrEqual(2);
      expect(selected.durationMinutes).toBeLessThanOrEqual(5);
    }
  });

  it('handles deep work fallback compression to preserve critical build momentum', () => {
    const state = ScenarioBuilder.create().build();
    const policy = getFallbackPolicyForTask(state, 'task-deep-work-build');
    expect(policy).toBeDefined();

    if (policy) {
      // If only 45 minutes available before departure or family
      const selected = selectOptimalFallbackTier(policy, 45, 'GREEN');
      expect(selected.durationMinutes).toBeLessThanOrEqual(45);
      expect(selected.expectedOutcome).toBeDefined();
    }
  });
});
