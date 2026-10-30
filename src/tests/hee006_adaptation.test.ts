import { describe, it, expect } from 'vitest';
import { 
  scanForAdaptationPatterns, 
  applyAdaptationProposal, 
  rejectAdaptationProposal 
} from '../services/adaptationEngine';
import { ScenarioBuilder } from './fixtures/scenarioBuilder';
import { AdaptationProposal } from '../types';

describe('HEE-006 — Adaptation Engine', () => {
  it('scans and returns discovered friction patterns and proposals', () => {
    const state = ScenarioBuilder.create().build();
    const result = scanForAdaptationPatterns(state);
    expect(result.patterns).toBeDefined();
    expect(result.proposals).toBeDefined();
    expect(result.patterns.length).toBeGreaterThan(0);
    expect(result.proposals.length).toBeGreaterThan(0);
  });

  it('differentiates between LOW_RISK_AUTO and HIGH_IMPACT_APPROVAL_REQUIRED proposals', () => {
    const state = ScenarioBuilder.create().build();
    const proposals = state.adaptationProposals || [];
    
    const lowRisk = proposals.filter(p => p.impactLevel === 'LOW_RISK_AUTO');
    const highRisk = proposals.filter(p => p.impactLevel === 'HIGH_IMPACT_APPROVAL_REQUIRED');

    expect(lowRisk.length + highRisk.length).toBe(proposals.length);
  });

  it('applies an approved proposal, modifying task properties and logging an audit event', () => {
    const state = ScenarioBuilder.create().build();
    const proposal: AdaptationProposal = {
      id: 'prop-test-adjust-workout',
      patternId: 'pattern-test',
      activityId: 'task-workout-morning',
      title: 'Shift Morning Workout to 15m Anchor',
      description: 'Compress workout duration to 15m based on recurring morning friction.',
      suggestedChange: {
        property: 'subtext',
        fromValue: 'Zone 2 / Kettlebell',
        toValue: 'Zone 2 / Express Kettlebell 15m',
      },
      impactLevel: 'LOW_RISK_AUTO',
      status: 'PROPOSED',
      proposedAt: new Date().toISOString(),
    };

    const stateWithProposal = {
      ...state,
      adaptationProposals: [...state.adaptationProposals, proposal],
    };

    const updatedState = applyAdaptationProposal(stateWithProposal, proposal.id);
    const updatedTask = updatedState.tasks.find(t => t.id === 'task-workout-morning');
    const updatedProp = updatedState.adaptationProposals.find(p => p.id === proposal.id);

    expect(updatedTask?.subtext).toBe('Zone 2 / Express Kettlebell 15m');
    expect(updatedProp?.status).toBe('APPLIED');
    expect(updatedProp?.appliedAt).toBeDefined();
    expect(updatedState.events.some(e => e.event_type === 'AdaptationApplied')).toBe(true);
  });

  it('correctly marks rejected proposals without modifying task definitions', () => {
    const state = ScenarioBuilder.create().build();
    const proposal = state.adaptationProposals[0];
    expect(proposal).toBeDefined();

    const originalTask = state.tasks.find(t => t.id === proposal.activityId);
    const originalSubtext = originalTask?.subtext;

    const rejectedState = rejectAdaptationProposal(state, proposal.id);
    const updatedProposal = rejectedState.adaptationProposals.find(p => p.id === proposal.id);
    const taskAfterReject = rejectedState.tasks.find(t => t.id === proposal.activityId);

    expect(updatedProposal?.status).toBe('REJECTED');
    expect(taskAfterReject?.subtext).toBe(originalSubtext);
  });
});
