import { describe, expect, it } from 'vitest';
import { createEmptyExecutionState } from '../data/defaultData';
import { scanLongitudinalAdaptations, measureAdaptationPerformance } from '../services/adaptationEngine';
import { checkTaskDependencies } from '../services/dependencyEngine';
import { upsertExternalExecutionGate } from '../services/externalExecutionGate';
import {
  acceptHOSDailyOperatingPlan,
  requestSingleActivityScheduleChange,
  resolveHOSScheduleProposal,
} from '../services/scheduleAuthority';
import { activateTomorrowIntent } from '../services/tomorrowPlanningEngine';
import { AppState, HOSDailyOperatingPlan, RoutineTask } from '../types';

const task = (id: string, start: number, end: number, protectedTask = false): RoutineTask => ({
  id,
  anchorId: 'ANCHOR_6_OPERATIONS',
  title: id,
  timeWindow: '',
  startMinutes: start,
  endMinutes: end,
  isNonNegotiable: protectedTask,
  completed: false,
  modesAllowed: ['GREEN', 'YELLOW', 'RED'],
  interactiveActionType: 'GENERIC',
  isProtected: protectedTask,
  category: protectedTask ? 'PROTECTED_COMMITMENT' : 'WORK',
});

function hosPlan(executionActivities: RoutineTask[]): HOSDailyOperatingPlan {
  return {
    planId: 'hos-plan-2026-10-31',
    planVersion: '1',
    subjectId: 'hos-subject-123',
    localDate: '2026-10-31',
    timezone: 'Africa/Nairobi',
    source: 'HOS',
    receivedAtUtc: '2026-10-31T05:00:00.000Z',
    executionActivities,
    commitments: [
      {
        id: 'protected-commitment',
        title: 'Protected Commitment',
        startMinutes: 800,
        endMinutes: 900,
        isProtected: true,
        source: 'HOS',
      },
    ],
    delegatedWindows: [
      {
        id: 'delegation-a',
        startMinutes: 600,
        endMinutes: 720,
        allowedActivityIds: ['work-a'],
        canReallocate: true,
        canCompress: true,
        canDefer: true,
      },
    ],
  };
}

describe('HumanKernelOS E1-E3 reconciliation certification', () => {
  it('E1: production state starts empty, truthful and without synthetic personal runtime state', () => {
    const state = createEmptyExecutionState();
    expect(state.tasks).toEqual([]);
    expect(state.historicalDays).toEqual([]);
    expect(state.adaptationPatterns).toEqual([]);
    expect(state.adaptationProposals).toEqual([]);
    expect(state.rewardPoints).toBe(0);
    expect(state.rewards).toEqual([]);
    expect(state.companyOfTheDay.companyName).toBe('');
    expect(state.dreamEntries).toEqual([]);
    expect(state.registeredDevices).toEqual([]);
  });

  it('E1: adaptation intelligence does not fabricate history when no execution evidence exists', () => {
    const state = createEmptyExecutionState();
    const result = scanLongitudinalAdaptations(state, '30d');
    expect(result.summary.dataCoverageDays).toBe(0);
    expect(result.summary.totalExecutionsAnalyzed).toBe(0);
    expect(result.patterns).toEqual([]);
    expect(result.proposals).toEqual([]);
  });

  it('E1: adaptation measurement remains OBSERVING without real post-change executions', () => {
    const state = createEmptyExecutionState();
    state.adaptationProposals = [{
      id: 'proposal-real-evidence-only',
      title: 'Test proposal',
      description: 'Must not fabricate improvement.',
      activityId: 'work-a',
      suggestedChange: { property: 'startMinutes', fromValue: 600, toValue: 620 },
      status: 'ACTIVE_MEASURING',
      appliedAt: '2026-10-30T00:00:00.000Z',
      measurement: {
        measurementStartedAt: '2026-10-30T00:00:00.000Z',
        evaluationWindowDays: 7,
        sampleCount: 0,
        preAdaptationMetrics: {
          failureRate: 40,
          onTimeRate: 60,
          averageDurationErrorMinutes: 10,
          fallbackRate: 20,
        },
        postAdaptationMetrics: {
          failureRate: 0,
          onTimeRate: 0,
          averageDurationErrorMinutes: 0,
          fallbackRate: 0,
        },
        isImproved: false,
        improvementScorePercent: 0,
        recommendation: 'CONTINUE_MEASURING',
      },
    } as any];

    const measured = measureAdaptationPerformance(state, 'proposal-real-evidence-only');
    const proposal = measured.adaptationProposals[0];
    expect(proposal.measurement?.sampleCount).toBe(0);
    expect(proposal.measurement?.status).toBe('OBSERVING');
    expect(proposal.measurement?.recommendation).toBe('CONTINUE_MEASURING');
    expect(proposal.measurement?.improvementScorePercent).toBe(0);
  });

  it('E2: core dependencies consume generic external gates without knowing domain policy', () => {
    let state = createEmptyExecutionState();
    state.tasks = [task('external-action', 600, 660)];

    state = upsertExternalExecutionGate(state, {
      id: 'gate-domain-x',
      sourceEngine: 'DOMAIN_X',
      targetActivityId: 'external-action',
      status: 'BLOCKED',
      reason: 'Owning domain has not authorized execution.',
    });

    const blocked = checkTaskDependencies(state, 'external-action');
    expect(blocked.isBlocked).toBe(true);
    expect(blocked.blockingReasons).toContain('Owning domain has not authorized execution.');

    state = upsertExternalExecutionGate(state, {
      id: 'gate-domain-x',
      sourceEngine: 'DOMAIN_X',
      targetActivityId: 'external-action',
      status: 'OPEN',
      reason: 'Owning domain authorized execution.',
    });

    expect(checkTaskDependencies(state, 'external-action').isBlocked).toBe(false);
  });

  it('E3: HOS Daily Operating Plan becomes the authoritative activity schedule', () => {
    const initial = createEmptyExecutionState();
    const plan = hosPlan([
      task('work-a', 600, 660),
      task('protected-a', 800, 900, true),
    ]);

    const state = acceptHOSDailyOperatingPlan(initial, plan);
    expect(state.scheduleAuthority?.mode).toBe('HOS');
    expect(state.scheduleAuthority?.authoritativePlan?.planId).toBe(plan.planId);
    expect(state.tasks.map(t => t.id)).toEqual(['work-a', 'protected-a']);
    expect(state.dynamicAllocations.find(a => a.activityId === 'work-a')?.allocatedStartMinutes).toBe(600);
  });

  it('E3: Execution OS may autonomously move work only inside HOS delegated boundaries', () => {
    const initial = acceptHOSDailyOperatingPlan(
      createEmptyExecutionState(),
      hosPlan([task('work-a', 600, 660), task('protected-a', 800, 900, true)])
    );

    const decision = requestSingleActivityScheduleChange(
      initial,
      'work-a',
      620,
      680,
      'Bounded recovery',
      'REALLOCATE'
    );

    expect(decision.applied).toBe(true);
    expect(decision.proposal?.status).toBe('AUTO_APPLIED_WITHIN_DELEGATION');
    expect(decision.state.tasks.find(t => t.id === 'work-a')?.allocatedStartMinutes).toBe(620);
  });

  it('E3: changes outside delegation become proposals and do not silently alter HOS schedule', () => {
    const initial = acceptHOSDailyOperatingPlan(
      createEmptyExecutionState(),
      hosPlan([task('work-a', 600, 660), task('protected-a', 800, 900, true)])
    );

    const decision = requestSingleActivityScheduleChange(
      initial,
      'work-a',
      760,
      820,
      'Would cross delegation and protected commitment',
      'DEFER'
    );

    expect(decision.applied).toBe(false);
    expect(decision.proposal?.status).toBe('PROPOSED');
    expect(decision.state.tasks.find(t => t.id === 'work-a')?.allocatedStartMinutes).toBe(600);

    const accepted = resolveHOSScheduleProposal(
      decision.state,
      decision.proposal!.id,
      'ACCEPT'
    );
    expect(accepted.scheduleProposals?.find(p => p.id === decision.proposal!.id)?.status).toBe('ACCEPTED');
    expect(accepted.tasks.find(t => t.id === 'work-a')?.allocatedStartMinutes).toBe(760);
  });

  it('E3: HOS-mode day activation does not generate a competing personal routine', () => {
    const initial = acceptHOSDailyOperatingPlan(
      createEmptyExecutionState(),
      hosPlan([task('work-a', 600, 660)])
    );
    const activation = activateTomorrowIntent(initial);
    expect(activation.state.tasks.map(t => t.id)).toEqual(['work-a']);
    expect(activation.result.instantiatedTasksCount).toBe(1);
    expect(activation.result.message).toContain('HOS Daily Operating Plan');
  });
});
