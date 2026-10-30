import { describe, it, expect } from 'vitest';
import { getFallbackPolicyForTask, selectOptimalFallbackTier, getTaskFallbackTiers } from '../services/fallbackEngine';
import { DEFAULT_APP_STATE } from '../data/defaultData';

describe('HEE-005 — Fallback Engine', () => {
  it('should retrieve multi-level fallback tiers for morning workout anchor', () => {
    const tiers = getTaskFallbackTiers(DEFAULT_APP_STATE, 'task-workout-morning');
    expect(tiers.length).toBeGreaterThanOrEqual(2);
    expect(tiers[0].level).toBe(0);
    expect(tiers[1].level).toBe(1);
  });

  it('should select Level 1 or 2 fallback in YELLOW mode', () => {
    const policy = getFallbackPolicyForTask(DEFAULT_APP_STATE, 'task-workout-morning');
    expect(policy).toBeDefined();
    if (policy) {
      const selectedTier = selectOptimalFallbackTier(policy, 10, 'YELLOW');
      expect(selectedTier.level).toBeGreaterThanOrEqual(1);
      expect(selectedTier.durationMinutes).toBeLessThanOrEqual(10);
    }
  });

  it('should select Level 2 or 3 recovery tier in RED mode', () => {
    const policy = getFallbackPolicyForTask(DEFAULT_APP_STATE, 'task-workout-morning');
    expect(policy).toBeDefined();
    if (policy) {
      const selectedTier = selectOptimalFallbackTier(policy, 5, 'RED');
      expect(selectedTier.level).toBeGreaterThanOrEqual(2);
    }
  });
});
