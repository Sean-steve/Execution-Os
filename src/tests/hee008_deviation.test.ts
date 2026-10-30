import { describe, it, expect } from 'vitest';
import { scanAndResolveDeviations } from '../services/deviationEngine';
import { ScenarioBuilder } from './fixtures/scenarioBuilder';

describe('HEE-008 — Deviation & Autonomous Intervention Engine', () => {
  it('scans and intercepts late execution windows, emitting DeviationRecord and InterventionRecord', () => {
    // Current time 08:30 (510 mins), morning anchors uncompleted
    const state = ScenarioBuilder.create()
      .withTime('08:30')
      .withUncompletedAll()
      .build();

    const { detectedDeviations, interventions, updatedState, hasNewDeviations } = scanAndResolveDeviations(state);

    expect(hasNewDeviations).toBe(true);
    expect(detectedDeviations.length).toBeGreaterThan(0);
    expect(interventions.length).toBeGreaterThan(0);

    const lateDev = detectedDeviations.find(d => d.type === 'LATE' || d.type === 'MISSED');
    expect(lateDev).toBeDefined();
    expect(lateDev?.isResolved).toBe(true);
    expect(lateDev?.resolvedAutonomously).toBe(true);

    // Event bus should contain DeviationDetected event
    expect(updatedState.events.some(e => e.event_type === 'DeviationDetected')).toBe(true);
  });

  it('scans and intercepts dependency failures when downstream tasks attempt premature execution', () => {
    const state = ScenarioBuilder.create()
      .withTime('09:00')
      .withUncompletedAll() // Command center is uncompleted, so deep work is blocked
      .build();

    const { detectedDeviations } = scanAndResolveDeviations(state);
    const depFailure = detectedDeviations.find(d => d.type === 'DEPENDENCY_FAILURE' && d.activityId === 'task-deep-work-build');
    
    expect(depFailure).toBeDefined();
    expect(depFailure?.activityId).toBe('task-deep-work-build');
    expect(depFailure?.likelyCause).toContain('Command Center');
  });

  it('preserves existing resolved deviations on subsequent idempotent scans', () => {
    const state = ScenarioBuilder.create()
      .withTime('08:30')
      .withUncompletedAll()
      .build();

    const scan1 = scanAndResolveDeviations(state);
    const scan2 = scanAndResolveDeviations(scan1.updatedState);

    expect(scan2.detectedDeviations.length).toBe(scan1.detectedDeviations.length);
    expect(scan2.interventions.length).toBe(scan1.interventions.length);
  });
});
