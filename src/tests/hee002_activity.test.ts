import { describe, it, expect } from 'vitest';
import { ScenarioBuilder } from './fixtures/scenarioBuilder';
import { ActivityDefinition, ActivityInstance } from '../types';

describe('HEE-002 — Activity Engine (Definitions & Instances)', () => {
  it('loads pristine Activity Definitions with required attributes and constraints', () => {
    const state = ScenarioBuilder.create().build();
    expect(state.activities).toBeDefined();
    expect(state.activities.length).toBeGreaterThanOrEqual(10);

    state.activities.forEach((act: ActivityDefinition) => {
      expect(act.id).toBeDefined();
      expect(act.anchorId).toBeDefined();
      expect(act.title).toBeDefined();
      expect(act.objective).toBeDefined();
      expect(act.priority).toBeGreaterThanOrEqual(1);
      expect(act.priority).toBeLessThanOrEqual(5);
      expect(act.estimatedDuration).toBeGreaterThan(0);
      expect(act.minimumDuration).toBeGreaterThan(0);
      expect(act.modesAllowed).toBeDefined();
      expect(act.modesAllowed.length).toBeGreaterThanOrEqual(1);
      expect(['LOW', 'MEDIUM', 'HIGH']).toContain(act.energyRequirement);
      expect(['LOW', 'MEDIUM', 'HIGH']).toContain(act.focusRequirement);
      expect(['MANUAL_CHECK', 'TIMER_PASS', 'GATE_VALIDATION', 'INPUT_ENTRY', 'AUTOMATIC']).toContain(act.verificationMethod);
    });
  });

  it('correctly filters allowed activities by current System Mode', () => {
    const greenState = ScenarioBuilder.create().withMode('GREEN').build();
    const greenTasks = greenState.tasks.filter(t => t.modesAllowed.includes('GREEN'));

    const redState = ScenarioBuilder.create().withMode('RED').build();
    const redTasks = redState.tasks.filter(t => t.modesAllowed.includes('RED'));

    // Red mode should be a reduced recovery subset of activities
    expect(redTasks.length).toBeLessThan(greenTasks.length);
    expect(redTasks.some(t => t.id === 'task-deep-work-build')).toBe(false); // Deep work stripped in Red mode
    expect(redTasks.some(t => t.id === 'task-awaken')).toBe(true); // Awakening preserved
    expect(redTasks.some(t => t.id === 'task-family-connection' || t.anchorId === 'ANCHOR_8_HUMAN_LIFE')).toBe(true); // Family preserved
  });

  it('maintains clear separation between definition templates and daily instances', () => {
    const state = ScenarioBuilder.create().build();
    expect(state.activityInstances).toBeDefined();
    
    // Check that every instance references a valid definition
    state.activityInstances.forEach((inst: ActivityInstance) => {
      const definition = state.activities.find(a => a.id === inst.activityDefinitionId);
      expect(definition).toBeDefined();
      expect(inst.date).toBeDefined();
      expect(inst.scheduledStartMinutes).toBeLessThan(inst.scheduledEndMinutes);
      expect(['PENDING', 'ACTIVE', 'ON_TIME', 'MISSED_LATE', 'COMPRESSED', 'FALLBACK_EXECUTED', 'SKIPPED', 'BLOCKED']).toContain(inst.executionStatus);
    });
  });
});
