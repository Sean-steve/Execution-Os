import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_STATE } from '../data/defaultData';
import { HumanPerformanceEngine } from '../services/performanceEngine';
import { IClock } from '../clock';
import {
  buildDailyPerformanceRecord,
  buildDayOfWeekPerformanceProfiles,
  buildWeeklyPerformanceRecord,
} from '../services/weeklyPerformanceIntelligence';
import { EntityMapper } from '../canonical/entityMapper';
import { InMemoryExecutionRepository } from '../services/repository';
import { ExecutionApplicationService } from '../services/executionApplicationService';
import { PerformanceAiPartner } from '../services/performanceAiPartner';
import { PerformanceIntegrationHub } from '../services/performanceIntegrationHub';
import { RecordTradingProtocolCommand } from '../commands';

function mutableClock(startIso = '2026-10-31T09:00:00.000Z') {
  let nowMs = new Date(startIso).getTime();
  const clock: IClock & { advanceMinutes: (minutes: number) => void } = {
    now: () => new Date(nowMs),
    toISOString: () => new Date(nowMs).toISOString(),
    getCurrentTimeMinutes: () => {
      const d = new Date(nowMs);
      return d.getUTCHours() * 60 + d.getUTCMinutes();
    },
    getTimeString: () => {
      const d = new Date(nowMs);
      return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
    },
    formatTime12Hour: () => new Date(nowMs).toISOString(),
    advanceMinutes: (minutes: number) => { nowMs += minutes * 60_000; },
  };
  return clock;
}

describe('Conversation end-state reconciliation acceptance', () => {
  it('HEE-011 rejects a claimed completion when required protocol evidence/steps are not satisfied', () => {
    const state = structuredClone(DEFAULT_APP_STATE);
    const task = state.tasks.find(t => t.interactiveActionType === 'FOCUS_BLOCK') || state.tasks[0];
    const clock = mutableClock();
    const engine = new HumanPerformanceEngine(clock);
    let session = engine.createSession(state, task.id);
    session = engine.startSession(session);

    const result = engine.closeSession(session, 'COMPLETED');
    expect(result.outcomeResult.outcome).toBe('PARTIAL');
    expect(result.updatedSession.status).toBe('PARTIAL');
  });

  it('HEE-011 accepts deep-work completion after minimum duration and required protocol steps', () => {
    const state = structuredClone(DEFAULT_APP_STATE);
    const task = state.tasks.find(t => t.interactiveActionType === 'FOCUS_BLOCK') || state.tasks[0];
    const clock = mutableClock();
    const engine = new HumanPerformanceEngine(clock);
    let session = engine.createSession(state, task.id);
    session = engine.startSession(session);
    session = engine.advanceStep(session, 0);
    session = engine.advanceStep(session, 1);
    session = engine.advanceStep(session, 2, { notes: 'Artifact captured' });
    session = engine.attachArtifact(session, {
      artifactType: 'NOTE',
      title: 'Deep work result',
      contentSnippet: 'Concrete objective output',
    });
    clock.advanceMinutes(46);

    const result = engine.closeSession(session, 'COMPLETED', {
      qualityAssessment: { score: 90, focusDepth: 'HIGH', interruptionImpact: 'NONE' },
    });
    expect(result.outcomeResult.outcome).toBe('COMPLETED');
    expect(result.outcomeResult.activeDurationSeconds).toBeGreaterThanOrEqual(45 * 60);
  });

  it('completion reward is idempotent through the authoritative command pipeline', async () => {
    const state = structuredClone(DEFAULT_APP_STATE);
    const task = state.tasks.find(t => !t.completed && t.interactiveActionType !== 'TRADING_GATEKEEPER')!;
    task.startMinutes = 0;
    task.endMinutes = 1439;
    task.allocatedStartMinutes = 0;
    task.allocatedEndMinutes = 1439;

    const repo = new InMemoryExecutionRepository(state);
    const app = new ExecutionApplicationService(repo, mutableClock());
    const first = await app.completeActivity({ taskId: task.id, executionStatus: 'ON_TIME' }, state);
    expect(first.success).toBe(true);
    const pointsAfterFirst = first.state.rewardPoints;

    const second = await app.completeActivity({ taskId: task.id, executionStatus: 'ON_TIME' }, first.state);
    expect(second.success).toBe(true);
    expect(second.state.rewardPoints).toBe(pointsAfterFirst);
  });

  it('No Setup = No Trade can close trading without fabricating a setup', async () => {
    const state = structuredClone(DEFAULT_APP_STATE);
    const tradingTask = state.tasks.find(t => t.id === 'task-trading-protocol') || state.tasks.find(t => t.interactiveActionType === 'TRADING_GATEKEEPER');
    expect(tradingTask).toBeDefined();
    if (!tradingTask) return;
    tradingTask.startMinutes = 0;
    tradingTask.endMinutes = 1439;

    const repo = new InMemoryExecutionRepository(state);
    const app = new ExecutionApplicationService(repo, mutableClock());
    const recorded = await app.dispatch(new RecordTradingProtocolCommand({
      protocol: {
        isTradingDay: true,
        marketAnalyzed: true,
        setupDetected: false,
        noSetupJustified: true,
        executed: false,
        closedTerminal: true,
      },
    }), state);
    expect(recorded.success).toBe(true);

    const completed = await app.completeActivity({ taskId: tradingTask.id, executionStatus: 'ON_TIME' }, recorded.state);
    expect(completed.success).toBe(true);
    expect(completed.state.tradingProtocol.setupDetected).toBe(false);
    expect(completed.state.tradingProtocol.executed).toBe(false);
  });

  it('WPI produces load-normalized daily and weekly records with explicit confidence', () => {
    const state = structuredClone(DEFAULT_APP_STATE);
    state.activeDate = '2026-10-27';
    state.tasks = state.tasks.map((t, index) => ({
      ...t,
      completed: index < Math.max(1, Math.floor(state.tasks.length * 0.8)),
      executionStatus: index < Math.max(1, Math.floor(state.tasks.length * 0.8)) ? 'ON_TIME' : 'PENDING',
    }));

    const daily = buildDailyPerformanceRecord(state, state.activeDate);
    const withDaily = { ...state, dailyPerformanceRecords: [daily] };
    const weekly = buildWeeklyPerformanceRecord(withDaily, state.activeDate);

    expect(daily.plannedLoadScore.value).toBeGreaterThanOrEqual(0);
    expect(daily.dimensionScores.length).toBeGreaterThanOrEqual(8);
    expect(daily.adjustedDayStrength).toBeGreaterThanOrEqual(0);
    expect(weekly.dailyRecordIds).toContain(daily.id);
    expect(weekly.confidence).toBe('INSUFFICIENT');
  });

  it('weekday intelligence requires repeated observations before STRONG confidence', () => {
    const base = structuredClone(DEFAULT_APP_STATE);
    const records = Array.from({ length: 10 }, (_, i) => {
      const date = new Date(Date.UTC(2026, 7, 4 + i * 7)).toISOString().slice(0, 10); // Tuesdays
      const state = structuredClone(base);
      state.activeDate = date;
      state.tasks = state.tasks.map(t => ({ ...t, completed: true, executionStatus: 'ON_TIME' }));
      return buildDailyPerformanceRecord(state, date);
    });
    const profiles = buildDayOfWeekPerformanceProfiles({ ...base, dailyPerformanceRecords: records });
    const tuesday = profiles.find(p => p.weekdayLabel === 'Tuesday');
    expect(tuesday?.sampleCount).toBe(10);
    expect(tuesday?.confidence).toBe('STRONG');
  });

  it('AI Execution Partner stays session-scoped and cannot silently mutate the execution state', async () => {
    const state = structuredClone(DEFAULT_APP_STATE);
    const task = state.tasks.find(t => t.interactiveActionType === 'FOCUS_BLOCK') || state.tasks[0];
    const engine = new HumanPerformanceEngine(mutableClock());
    const session = engine.createSession(state, task.id);
    const stateBefore = JSON.stringify(state);

    const partner = new PerformanceAiPartner({
      generate: async () => 'Execute the smallest concrete next step and capture the result.',
    });
    const result = await partner.respond({
      session,
      state,
      message: 'Help me finish this objective.',
      mode: 'COACH',
    });

    expect(result.scopedContext.sessionId).toBe(session.id);
    expect(result.scopedContext.activityId).toBe(task.id);
    expect(result.requiresApproval).toBe(false);
    expect(JSON.stringify(state)).toBe(stateBefore);
  });

  it('AI Execution Partner marks extension requests as requiring governed approval', async () => {
    const state = structuredClone(DEFAULT_APP_STATE);
    const task = state.tasks.find(t => t.interactiveActionType === 'FOCUS_BLOCK') || state.tasks[0];
    const session = new HumanPerformanceEngine(mutableClock()).createSession(state, task.id);
    const partner = new PerformanceAiPartner({
      generate: async () => 'Request the extension through HEE.',
    });

    const result = await partner.respond({
      session,
      state,
      message: 'I need 20 more minutes.',
      mode: 'COACH',
    });

    expect(result.requiresApproval).toBe(true);
    expect(result.proposedAction?.type).toBe('REQUEST_EXTENSION');
  });

  it('integration evidence hub validates Git evidence and rejects malformed references', () => {
    const state = structuredClone(DEFAULT_APP_STATE);
    const task = state.tasks.find(t => t.interactiveActionType === 'FOCUS_BLOCK') || state.tasks[0];
    const session = new HumanPerformanceEngine(mutableClock()).createSession(state, task.id);
    const hub = new PerformanceIntegrationHub();

    const valid = hub.collectEvidence(session, state, {
      adapterId: 'git-commit',
      payload: { repository: 'Sean-steve/Execution-Os', sha: 'abcdef1234567' },
    });
    const invalid = hub.collectEvidence(session, state, {
      adapterId: 'git-commit',
      payload: { repository: 'Execution-Os', sha: 'x' },
    });

    expect(valid.valid).toBe(true);
    expect(valid.trustLevel).toBe('E2');
    expect(invalid.valid).toBe(false);
  });

  it('canonical mapper preserves HEE-011 and WPI records across a persistence round-trip', () => {
    const state = structuredClone(DEFAULT_APP_STATE);
    const task = state.tasks[0];
    const clock = mutableClock();
    const engine = new HumanPerformanceEngine(clock);
    const session = engine.createSession(state, task.id);
    state.performanceSessions = [session];
    const daily = buildDailyPerformanceRecord(state, '2026-10-31');
    state.dailyPerformanceRecords = [daily];
    state.weeklyPerformanceRecords = [buildWeeklyPerformanceRecord(state, '2026-10-31')];

    const mapper = new EntityMapper('user_primary', 'Africa/Nairobi');
    const canonical = mapper.appStateToCanonical(state);
    const restored = mapper.canonicalToAppState(canonical, structuredClone(DEFAULT_APP_STATE));

    expect(restored.performanceSessions?.[0]?.id).toBe(session.id);
    expect(restored.dailyPerformanceRecords?.[0]?.id).toBe(daily.id);
    expect(restored.weeklyPerformanceRecords?.length).toBe(1);
  });
});
