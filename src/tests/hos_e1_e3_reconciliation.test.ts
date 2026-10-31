import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_STATE } from '../data/defaultData';
import { createRuntimeInitialState } from '../data/runtimeInitialState';
import { applyAdaptationProposal } from '../services/adaptationEngine';
import { calculateDynamicAllocations } from '../services/allocationEngine';
import {
  bindHosDailyOperatingPlan,
  getProtectedScheduleWindows,
  resolveScheduleProposal,
} from '../services/scheduleAuthorityService';
import { checkTaskDependencies } from '../services/dependencyEngine';
import { GovernanceEngine } from '../server/governance';
import { InMemoryExecutionRepository } from '../services/repository';
import { ExecutionApplicationService } from '../services/executionApplicationService';

describe('HOS readiness E1-E3 certification', () => {
  it('E1: production runtime starts with no synthetic or personal execution truth', () => {
    const state = createRuntimeInitialState();

    expect(state.historicalDays).toEqual([]);
    expect(state.adaptationPatterns).toEqual([]);
    expect(state.adaptationProposals).toEqual([]);
    expect(state.tasks).toEqual([]);
    expect(state.activities).toEqual([]);
    expect(state.rewardPoints).toBe(0);
    expect(state.companyOfTheDay.companyName).toBe('');
    expect(state.tradingProtocol.isTradingDay).toBe(false);
    expect(state.autonomousResolutionCount).toBe(0);
    expect(state.scheduleAuthority?.mode).toBe('HOS_DELEGATED');
  });

  it('E1: applying an adaptation does not fabricate post-change improvement', () => {
    const state = structuredClone(DEFAULT_APP_STATE);
    const proposal = state.adaptationProposals[0];
    expect(proposal).toBeDefined();
    if (!proposal) return;

    const applied = applyAdaptationProposal(state, proposal.id);
    const updated = applied.adaptationProposals.find(p => p.id === proposal.id);
    expect(updated?.measurement?.sampleCount).toBe(0);
    expect(updated?.measurement?.isImproved).toBe(false);
    expect(updated?.measurement?.improvementScorePercent).toBe(0);
    expect(updated?.measurement?.recommendation).toBe('CONTINUE_MEASURING');
    expect(updated?.measurement?.status).toBe('OBSERVING_NO_POST_CHANGE_EVIDENCE');
  });

  it('E2: trading rules are enforced through domain policy adapters while generic dependencies remain intact', () => {
    const state = structuredClone(DEFAULT_APP_STATE);
    state.tradingProtocol = {
      ...state.tradingProtocol,
      isTradingDay: true,
      marketAnalyzed: false,
      setupDetected: false,
      noSetupJustified: false,
    };

    const blocked = checkTaskDependencies(state, 'task-trading-execution');
    expect(blocked.isBlocked).toBe(true);
    expect(blocked.blockingReasons.join(' ')).toMatch(/market analysis|setup/i);

    const genericTask = state.tasks.find(t => t.id !== 'task-trading-protocol' && t.id !== 'task-trading-execution')!;
    const generic = checkTaskDependencies(state, genericTask.id);
    expect(generic).toBeDefined();
  });

  it('E2: protected commitment governance is driven by plan data, not a family-specific hard-coded window', () => {
    const state = structuredClone(DEFAULT_APP_STATE);
    const task = state.tasks.find(t => !t.isProtected && !t.id.includes('family'))!;
    state.scheduleAuthority = {
      mode: 'HOS_DELEGATED',
      planId: 'dop-1',
      planRevision: 2,
      approvedWindows: [{ id: 'work', startMinutes: 400, endMinutes: 900, type: 'EXECUTION_ALLOWED', source: 'HOS' }],
      protectedWindows: [{ id: 'medical', startMinutes: 700, endMinutes: 760, type: 'PROTECTED', label: 'Medical appointment', source: 'HOS' }],
      maxAutonomousShiftMinutes: 15,
      allowAutonomousCompression: false,
    };
    state.tomorrowPlan.protectedCommitments = [];

    const windows = getProtectedScheduleWindows(state);
    expect(windows.some(w => w.id === 'medical')).toBe(true);

    const result = GovernanceEngine.evaluateActivitySchedule(state, task.id, 710, 740);
    expect(result.allowed).toBe(false);
    expect((result.error as any)?.code).toBe('GOVERNANCE_DENIED');
    expect(result.error?.message).toMatch(/Medical appointment/);
  });

  it('E3: HOS-delegated reallocation becomes a proposal when outside granted boundaries', () => {
    const state = structuredClone(DEFAULT_APP_STATE);
    state.isSimulatedTime = true;
    state.simulatedTime = '11:00';
    state.scheduleAuthority = {
      mode: 'HOS_DELEGATED',
      planId: 'dop-2',
      planRevision: 1,
      approvedWindows: [],
      protectedWindows: [],
      maxAutonomousShiftMinutes: 0,
      allowAutonomousCompression: false,
    };

    const before = new Map(state.tasks.map(t => [t.id, { start: t.startMinutes, end: t.endMinutes }]));
    const result = calculateDynamicAllocations(state);

    expect(result.scheduleProposal).toBeDefined();
    expect(result.proposedChangesCount).toBeGreaterThan(0);
    for (const task of result.recalculatedTasks) {
      const original = before.get(task.id);
      if (!original) continue;
      expect(task.startMinutes).toBe(original.start);
      expect(task.endMinutes).toBe(original.end);
    }
  });

  it('E3: small reallocations may remain autonomous only inside HOS-approved windows', () => {
    const state = structuredClone(DEFAULT_APP_STATE);
    const target = state.tasks.find(t => !t.isProtected && !t.isNonNegotiable)!;
    state.tasks = [target];
    state.activities = state.activities.filter(a => a.id === target.id);
    state.dependencies = [];
    state.fallbackPolicies = [];
    state.isSimulatedTime = true;
    state.simulatedTime = '06:00';
    target.startMinutes = 365;
    target.endMinutes = 395;

    state.scheduleAuthority = {
      mode: 'HOS_DELEGATED',
      planId: 'dop-3',
      planRevision: 1,
      approvedWindows: [{ id: 'bounded-work', startMinutes: 360, endMinutes: 480, type: 'EXECUTION_ALLOWED', source: 'HOS' }],
      protectedWindows: [],
      maxAutonomousShiftMinutes: 10,
      allowAutonomousCompression: false,
    };

    const result = calculateDynamicAllocations(state);
    expect(result.scheduleProposal).toBeUndefined();
    expect(result.proposedChangesCount).toBe(0);
  });

  it('E3: direct defer command proposes to HOS instead of mutating the authoritative plan', async () => {
    const state = structuredClone(DEFAULT_APP_STATE);
    const task = state.tasks.find(t => !t.isProtected)!;
    state.scheduleAuthority = {
      mode: 'HOS_DELEGATED',
      planId: 'dop-4',
      planRevision: 3,
      approvedWindows: [],
      protectedWindows: [],
      maxAutonomousShiftMinutes: 0,
      allowAutonomousCompression: false,
    };
    const beforeStart = task.startMinutes;
    const repo = new InMemoryExecutionRepository(state);
    const app = new ExecutionApplicationService(repo);

    const result = await app.deferActivity(task.id, 30, 'Reality changed', state);

    expect(result.success).toBe(true);
    expect(result.state.tasks.find(t => t.id === task.id)?.startMinutes).toBe(beforeStart);
    expect(result.state.pendingScheduleProposals?.some(p => p.status === 'PROPOSED')).toBe(true);
    expect(result.events.some(e => e.event_type === 'ScheduleChangeProposed')).toBe(true);
  });

  it('E3: binding a new HOS Daily Operating Plan supersedes stale proposals and HOS can explicitly accept a proposal', () => {
    let state = structuredClone(DEFAULT_APP_STATE);
    state.pendingScheduleProposals = [{
      id: 'old',
      source: 'EXECUTION_OS',
      authority: 'HOS',
      createdAtUtc: new Date().toISOString(),
      reason: 'old proposal',
      status: 'PROPOSED',
      changes: [],
    }];

    state = bindHosDailyOperatingPlan(state, {
      mode: 'HOS_DELEGATED',
      planId: 'dop-current',
      planRevision: 7,
      approvedWindows: [{ id: 'work', startMinutes: 480, endMinutes: 900, type: 'EXECUTION_ALLOWED', source: 'HOS' }],
      protectedWindows: [{ id: 'fixed', startMinutes: 900, endMinutes: 960, type: 'FIXED', source: 'HOS' }],
      maxAutonomousShiftMinutes: 15,
      allowAutonomousCompression: true,
    });

    expect(state.pendingScheduleProposals?.find(p => p.id === 'old')?.status).toBe('SUPERSEDED');
    expect(state.scheduleAuthority?.planRevision).toBe(7);

    const task = state.tasks[0];
    state.pendingScheduleProposals = [{
      id: 'new',
      source: 'EXECUTION_OS',
      authority: 'HOS',
      planId: 'dop-current',
      planRevision: 7,
      createdAtUtc: new Date().toISOString(),
      reason: 'test',
      status: 'PROPOSED',
      changes: [{
        activityId: task.id,
        fromStartMinutes: task.startMinutes,
        fromEndMinutes: task.endMinutes,
        proposedStartMinutes: task.startMinutes + 10,
        proposedEndMinutes: task.endMinutes + 10,
        compressed: false,
      }],
    }];

    const accepted = resolveScheduleProposal(state, 'new', 'ACCEPTED');
    expect(accepted.pendingScheduleProposals?.find(p => p.id === 'new')?.status).toBe('ACCEPTED');
    expect(accepted.tasks.find(t => t.id === task.id)?.allocatedStartMinutes).toBe(task.startMinutes + 10);
  });
});
