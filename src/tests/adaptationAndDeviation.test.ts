import { describe, it, expect } from 'vitest';
import { scanForAdaptationPatterns, applyAdaptationProposal } from '../services/adaptationEngine';
import { scanAndResolveDeviations } from '../services/deviationEngine';
import { DEFAULT_APP_STATE } from '../data/defaultData';
import { AppState } from '../types';

describe('HEE-006 & HEE-008 — Deviation & Adaptation Engines', () => {
  it('should scan and detect deviations when schedule is disrupted', () => {
    const state: AppState = {
      ...DEFAULT_APP_STATE,
      isSimulatedTime: true,
      simulatedTime: '08:45',
      tasks: DEFAULT_APP_STATE.tasks.map(t =>
        t.startMinutes < 480 ? { ...t, completed: false } : t
      ),
    };

    const { detectedDeviations, interventions } = scanAndResolveDeviations(state);
    expect(detectedDeviations.length).toBeGreaterThan(0);
    expect(interventions.length).toBeGreaterThan(0);
  });

  it('should scan for adaptation patterns and return existing proposals', () => {
    const { patterns, proposals } = scanForAdaptationPatterns(DEFAULT_APP_STATE);
    expect(patterns).toBeDefined();
    expect(proposals).toBeDefined();
    expect(proposals.length).toBeGreaterThan(0);
  });

  it('should apply an approved adaptation proposal and update task properties cleanly', () => {
    const state = { ...DEFAULT_APP_STATE };
    const firstProposal = state.adaptationProposals[0];
    expect(firstProposal).toBeDefined();

    if (firstProposal) {
      const nextState = applyAdaptationProposal(state, firstProposal.id);
      const updatedProp = nextState.adaptationProposals.find(p => p.id === firstProposal.id);
      expect(updatedProp?.status).toBe('APPLIED');
    }
  });
});
