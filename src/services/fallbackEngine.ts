import { AppState, FallbackPolicy, FallbackTier, RoutineTask, SystemMode } from '../types';

export const getFallbackPolicyForTask = (
  state: AppState,
  taskId: string
): FallbackPolicy | null => {
  const policies = state.fallbackPolicies || [];
  return policies.find(p => p.activityId === taskId) || null;
};

/**
 * Evaluates the optimal fallback tier given available time and system mode
 */
export const selectOptimalFallbackTier = (
  policy: FallbackPolicy,
  availableMinutes: number,
  mode: SystemMode
): FallbackTier => {
  const tiers = [...policy.tiers].sort((a, b) => a.level - b.level);

  // If in RED mode, force tier 2 or 3 (MVR or recovery)
  if (mode === 'RED') {
    const redTier = tiers.find(t => t.level >= 2 && t.durationMinutes <= availableMinutes) || tiers[tiers.length - 1];
    return redTier;
  }

  // If in YELLOW mode, prefer tier 1 or 2
  if (mode === 'YELLOW') {
    const yellowTier = tiers.find(t => t.level >= 1 && t.durationMinutes <= availableMinutes) || tiers[tiers.length - 1];
    return yellowTier;
  }

  // Green mode: find highest achievable tier that fits available time
  for (const tier of tiers) {
    if (tier.durationMinutes <= availableMinutes) {
      return tier;
    }
  }

  // Fallback to highest level (shortest duration)
  return tiers[tiers.length - 1];
};

/**
 * Returns available fallback tiers for a task
 */
export const getTaskFallbackTiers = (
  state: AppState,
  taskId: string
): FallbackTier[] => {
  const policy = getFallbackPolicyForTask(state, taskId);
  return policy ? policy.tiers : [];
};
