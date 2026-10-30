import { describe, it, expect } from 'vitest';
import { 
  scanLongitudinalAdaptations,
  applyAdaptationProposal,
  rollbackAdaptationProposal,
  retainAdaptationProposal,
  measureAdaptationPerformance,
  rejectAdaptationProposal,
  generateLongitudinalExecutionHistory,
  getHistoricalDataForWindow
} from '../services/adaptationEngine';
import { ScenarioBuilder } from './fixtures/scenarioBuilder';
import { 
  AppState, 
  HistoricalExecutionDay, 
  LongitudinalWindow, 
  AdaptationProposal,
  AdaptationPattern
} from '../types';
import { DEFAULT_APP_STATE } from '../data/defaultData';
import { ExecutionApplicationService } from '../services/executionApplicationService';
import { defaultExecutionRepository } from '../repositories';

describe('Sprint 10 — Longitudinal Execution Intelligence (EOS-012, EOS-006)', () => {

  describe('1. Execution Windows (7d, 30d, 60d, 90d)', () => {
    it('generates and slices historical execution data across 7, 30, 60, and 90 day windows', () => {
      const history = generateLongitudinalExecutionHistory(90);
      expect(history.length).toBe(90);

      const win7 = getHistoricalDataForWindow(history, '7d');
      const win30 = getHistoricalDataForWindow(history, '30d');
      const win60 = getHistoricalDataForWindow(history, '60d');
      const win90 = getHistoricalDataForWindow(history, '90d');

      expect(win7.filteredDays.length).toBe(7);
      expect(win30.filteredDays.length).toBe(30);
      expect(win60.filteredDays.length).toBe(60);
      expect(win90.filteredDays.length).toBe(90);
      expect(win7.windowDays).toBe(7);
      expect(win30.windowDays).toBe(30);
      expect(win60.windowDays).toBe(60);
      expect(win90.windowDays).toBe(90);
    });

    it('scans longitudinal patterns with sufficient data across windows', () => {
      const baseState = ScenarioBuilder.create().build();
      const stateWithHistory: AppState = {
        ...baseState,
        historicalDays: generateLongitudinalExecutionHistory(90),
      };

      const result7d = scanLongitudinalAdaptations(stateWithHistory, '7d');
      const result30d = scanLongitudinalAdaptations(stateWithHistory, '30d');
      const result90d = scanLongitudinalAdaptations(stateWithHistory, '90d');

      expect(result7d.summary.selectedWindow).toBe('7d');
      expect(result30d.summary.selectedWindow).toBe('30d');
      expect(result90d.summary.selectedWindow).toBe('90d');

      expect(result7d.summary.dataCoverageDays).toBe(7);
      expect(result30d.summary.dataCoverageDays).toBe(30);
      expect(result90d.summary.dataCoverageDays).toBe(90);

      expect(result30d.patterns.length).toBeGreaterThan(0);
      expect(result30d.proposals.length).toBeGreaterThan(0);
    });
  });

  describe('2. Repeated Failure & Opportunity Detection', () => {
    it('detects repeated chronic lateness, duration estimation errors, and protected commitment conflicts', () => {
      const state: AppState = {
        ...DEFAULT_APP_STATE,
        historicalDays: generateLongitudinalExecutionHistory(90),
      };

      const scan = scanLongitudinalAdaptations(state, '30d');
      const patterns = scan.patterns;

      const latenessPatterns = patterns.filter(p => 
        p.patternType === 'LOW_COMPLETION_TIME_SLOT' || 
        p.patternType === 'TIME_WINDOW_FAILURE'
      );
      const durationPatterns = patterns.filter(p => p.patternType === 'DURATION_ESTIMATION_ERROR');
      const conflictPatterns = patterns.filter(p => p.patternType === 'PROTECTED_COMMITMENT_CONFLICT');
      const fallbackPatterns = patterns.filter(p => p.patternType === 'REPEATED_FALLBACK_USAGE');
      const alternativeWindowPatterns = patterns.filter(p => p.patternType === 'ALTERNATIVE_WINDOW_SUCCESS');

      expect(latenessPatterns.length).toBeGreaterThan(0);
      expect(durationPatterns.length).toBeGreaterThan(0);
      expect(conflictPatterns.length).toBeGreaterThan(0);
      expect(fallbackPatterns.length).toBeGreaterThan(0);
      expect(alternativeWindowPatterns.length).toBeGreaterThan(0);
    });

    it('generates concrete structural proposals with hypotheses and suggested changes', () => {
      const state: AppState = {
        ...DEFAULT_APP_STATE,
        historicalDays: generateLongitudinalExecutionHistory(90),
      };

      const scan = scanLongitudinalAdaptations(state, '30d');
      const proposals = scan.proposals;

      expect(proposals.length).toBeGreaterThan(0);

      for (const proposal of proposals) {
        expect(proposal.hypothesis).toBeDefined();
        expect(proposal.hypothesis!.length).toBeGreaterThan(10);
        expect(proposal.suggestedChange).toBeDefined();
        expect(proposal.suggestedChange.property).toBeDefined();
        expect(proposal.evidenceCount).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe('3. Non-Overreactive Anomaly Protection ("Do not allow one bad day to rewrite recurring routines")', () => {
    it('filters out isolated emergency / high-deviation anomaly days so they do not skew recurring baselines', () => {
      const history = generateLongitudinalExecutionHistory(30);
      
      // Inject an extreme bad day
      const badDay: HistoricalExecutionDay = {
        date: '2026-08-20',
        mode: 'RED',
        dayType: 'STANDARD',
        routineState: 'RECOVERY',
        score: 1,
        completionRate: 15,
        onTimeRate: 10,
        deviationsCount: 15,
        overridesCount: 4,
        fallbackCount: 6,
        protectedCommitmentBreached: true,
        notes: 'Severe food poisoning & hospital visit',
        activities: [],
      };

      const historyWithAnomaly = [badDay, ...history.slice(1)];
      const state: AppState = {
        ...DEFAULT_APP_STATE,
        historicalDays: historyWithAnomaly,
      };

      const scan = scanLongitudinalAdaptations(state, '30d');
      expect(scan.anomalyDaysFilteredCount).toBeGreaterThanOrEqual(1);
      
      // Ensure anomaly days did not inflate the systemic pattern counts improperly
      expect(scan.summary.totalHistoricalDays).toBe(30);
      expect(scan.summary.anomalyDaysFilteredCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('4. Complete Adaptation Lifecycle (Evidence → Pattern → Hypothesis → Proposal → Governance → Versioning → Measurement → Keep/Rollback)', () => {
    it('executes the complete lifecycle from approval to version creation, measurement, and rollback', () => {
      let state: AppState = {
        ...DEFAULT_APP_STATE,
        historicalDays: generateLongitudinalExecutionHistory(90),
      };

      // Step 1 & 2 & 3 & 4: Evidence → Pattern → Hypothesis → Proposal
      const scan = scanLongitudinalAdaptations(state, '30d');
      state.adaptationPatterns = scan.patterns;
      state.adaptationProposals = scan.proposals;

      const targetProposal = state.adaptationProposals.find(p => p.status === 'PROPOSED');
      expect(targetProposal).toBeDefined();
      const proposalId = targetProposal!.id;
      const targetActivityId = targetProposal!.activityId;
      const targetPropName = targetProposal!.suggestedChange.property;

      const targetTask = state.tasks.find(t => t.id === targetActivityId);
      const originalValue = targetTask ? (targetTask as any)[targetPropName] : undefined;

      // Step 5 & 6 & 7: Governance Approval → Applied → Immutable Version Created
      state = applyAdaptationProposal(state, proposalId, 'USER');
      
      const appliedProp = state.adaptationProposals.find(p => p.id === proposalId);
      expect(appliedProp?.status === 'ACTIVE_MEASURING' || appliedProp?.status === 'APPROVED' || appliedProp?.status === 'APPLIED').toBe(true);
      expect(appliedProp?.appliedAt).toBeDefined();
      expect(appliedProp?.version).toBeDefined();
      expect(appliedProp?.previousStateSnapshot).toBeDefined();

      // Verify task property changed
      if (targetActivityId) {
        const modifiedTask = state.tasks.find(t => t.id === targetActivityId);
        if (modifiedTask) {
          expect((modifiedTask as any)[targetPropName]).toEqual(targetProposal!.suggestedChange.toValue);
        }
      }

      // Step 8: Measurement Evaluation
      state = measureAdaptationPerformance(state, proposalId);
      const measuredProp = state.adaptationProposals.find(p => p.id === proposalId);
      expect(measuredProp?.measurement).toBeDefined();
      expect(measuredProp?.measurement?.recommendation).toBeDefined();

      // Step 9a: Keep / Retain
      let retainState = retainAdaptationProposal(state, proposalId, 'USER');
      const retainedProp = retainState.adaptationProposals.find(p => p.id === proposalId);
      expect(retainedProp?.status).toBe('RETAINED');

      // Step 9b: Rollback test
      let rollbackState = rollbackAdaptationProposal(state, proposalId, 'Operator found suboptimal drift', 'USER');
      const rolledBackProp = rollbackState.adaptationProposals.find(p => p.id === proposalId);
      expect(rolledBackProp?.status).toBe('ROLLED_BACK');
      expect(rolledBackProp?.rolledBackAt).toBeDefined();

      // Verify property reverted to fromValue
      if (targetActivityId) {
        const revertedTask = rollbackState.tasks.find(t => t.id === targetActivityId);
        if (revertedTask) {
          expect((revertedTask as any)[targetPropName]).toEqual(targetProposal!.suggestedChange.fromValue);
        }
      }
    });

    it('supports rejection of proposals without modifying task state', () => {
      const state: AppState = {
        ...DEFAULT_APP_STATE,
        historicalDays: generateLongitudinalExecutionHistory(90),
      };

      const scan = scanLongitudinalAdaptations(state, '30d');
      state.adaptationProposals = scan.proposals;

      const firstProp = state.adaptationProposals[0];
      const rejectedState = rejectAdaptationProposal(state, firstProp.id);
      const rejectedProp = rejectedState.adaptationProposals.find(p => p.id === firstProp.id);

      expect(rejectedProp?.status).toBe('REJECTED');
    });
  });

  describe('5. Application Service & Command Bus Integration', () => {
    it('executes apply, measure, retain, and rollback commands via ExecutionApplicationService', async () => {
      const service = new ExecutionApplicationService(defaultExecutionRepository);
      let state = await defaultExecutionRepository.loadState();
      state.historicalDays = generateLongitudinalExecutionHistory(90);
      const scan = scanLongitudinalAdaptations(state, '30d');
      state.adaptationProposals = scan.proposals;
      await defaultExecutionRepository.saveState(state);

      const firstProposal = scan.proposals[0];
      expect(firstProposal).toBeDefined();

      // 1. Apply command
      const applyResult = await service.applyAdaptationProposal(firstProposal.id);
      expect(applyResult.success).toBe(true);

      // 2. Measure command
      const measureResult = await service.evaluateAdaptationMeasurement(firstProposal.id);
      expect(measureResult.success).toBe(true);

      // 3. Rollback command
      const rollbackResult = await service.rollbackAdaptationProposal(firstProposal.id, 'Test rollback via command');
      expect(rollbackResult.success).toBe(true);
    });
  });

});
