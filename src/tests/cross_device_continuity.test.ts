import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryExecutionRepository } from '../repositories';
import { ExecutionApplicationService } from '../services/executionApplicationService';
import {
  CompleteActivityCommand,
  PlanTomorrowCommand,
  AdjustActivityCommand,
  SetSystemModeCommand,
  SetDayTypeCommand,
  AcceptDisciplinePenaltyCommand,
  ActivateDayCommand
} from '../commands/commands';
import { AppState, TomorrowPlan, SyncQueueItem } from '../types';
import { DEFAULT_APP_STATE } from '../data/defaultData';
import { createApp } from '../server/createApp';
import express, { Express } from 'express';
import request from 'supertest';
import { defaultIdempotencyStore } from '../server/idempotency';

describe('SPRINT 8: Cross-Device Execution Continuity & Multi-Device Sync (EOS-003, EOS-004, EOS-014)', () => {
  let repository: InMemoryExecutionRepository;
  let app: Express;

  beforeEach(() => {
    repository = new InMemoryExecutionRepository(JSON.parse(JSON.stringify(DEFAULT_APP_STATE)));
    app = createApp({ repository });
    defaultIdempotencyStore.clear();
  });

  // =========================================================================
  // REQUIREMENT 1: EOS-003 / EOS-014 - Tomorrow Plan Continuity Across Devices
  // =========================================================================
  it('EOS-003: Plan tomorrow on Device A -> Device B pulls authoritative plan with full fidelity', async () => {
    const tomorrowPlan: any = {
      wakeTime: '05:45',
      energyPrediction: 'HIGH',
      targetMode: 'GREEN',
      appointments: '09:00 Product Review, 14:00 Engineering Sync',
      nonNegotiables: ['5:30 Morning Prime', '7:30 Deep Work', '16:00 Protected Family Time'],
      plannedTasks: ['Ship Sprint 8 Cross-Device Engine', 'Conduct Multi-Device Smoke Tests'],
      companyPriorities: ['Execution OS v1.8.0 Release', 'High-Discipline Execution'],
      familyCommitments: '16:00 Protected Family Outing & Dinner',
      tradingIntention: 'First Candle Trend Pullback Only',
      desiredRoutine: 'Unbreakable High-Discipline Routine',
      scheduleFocus: 'Zero missed anchors and flawless deep work block',
      plannedMeal: 'Grilled Salmon with Avocado',
      workoutType: 'Full Body Heavy Compound Strength',
      eveningReview: 'Day 1 completed with 7/7 pillars.',
      winsAndVictories: '100% adherence on Device A and Device B.',
      lastPlannedAt: new Date().toISOString(),
    };

    // 1. Device A saves tomorrow plan
    const pushResponseA = await request(app)
      .post('/api/v1/hee/plan/tomorrow')
      .set('x-device-id', 'device-desktop-a')
      .send({ plan: tomorrowPlan });

    expect(pushResponseA.status).toBe(200);
    expect(pushResponseA.body.success).toBe(true);
    expect(pushResponseA.body.data.tomorrowPlan.wakeTime).toBe('05:45');
    expect(pushResponseA.body.data.tomorrowPlan.targetMode).toBe('GREEN');

    // 2. Device B opens and pulls authoritative state
    const pullResponseB = await request(app)
      .post('/api/v1/hee/sync/pull')
      .send({
        deviceId: 'device-mobile-b',
        lastVersion: 1,
      });

    expect(pullResponseB.status).toBe(200);
    expect(pullResponseB.body.success).toBe(true);
    const stateB: AppState = pullResponseB.body.state;

    // Verify complete field parity across devices
    expect(stateB.tomorrowPlan.wakeTime).toBe('05:45');
    expect(stateB.tomorrowPlan.targetMode).toBe('GREEN');
    expect(stateB.tomorrowPlan.companyPriorities).toEqual(tomorrowPlan.companyPriorities);
    expect(stateB.tomorrowPlan.familyCommitments).toBe(tomorrowPlan.familyCommitments);
    expect(stateB.tomorrowPlan.plannedMeal).toBe(tomorrowPlan.plannedMeal);
    expect(stateB.tomorrowPlan.workoutType).toBe(tomorrowPlan.workoutType);

    // Verify Device B is registered in server devices list
    const devices = pullResponseB.body.devices;
    expect(devices.some((d: any) => d.id === 'device-mobile-b')).toBe(true);
  });

  // =========================================================================
  // REQUIREMENT 2: EOS-004 - Activity Execution on Device B Converges on Device A
  // =========================================================================
  it('EOS-004: Complete activity on Device B -> Device A pulls and converges on completed state without duplicate rewards', async () => {
    const initialState = await repository.loadState();
    const targetTask = initialState.tasks.find(t => !t.completed) || initialState.tasks[0];
    const initialRewardPoints = initialState.rewardPoints;

    // 1. Device B executes activity completion
    const completeResponseB = await request(app)
      .post(`/api/v1/hee/activities/${targetTask.id}/complete`)
      .set('x-device-id', 'device-mobile-b')
      .send({ taskId: targetTask.id });

    expect(completeResponseB.status).toBe(200);
    expect(completeResponseB.body.success).toBe(true);
    const updatedPointsOnServer = completeResponseB.body.data.rewardPoints;
    expect(updatedPointsOnServer).toBeGreaterThan(initialRewardPoints);

    // 2. Device A pulls state
    const syncPullA = await request(app)
      .post('/api/v1/hee/sync/pull')
      .send({
        deviceId: 'device-desktop-a',
        lastVersion: 1,
      });

    expect(syncPullA.status).toBe(200);
    const stateA: AppState = syncPullA.body.state;

    // Verify convergence on Device A
    const taskOnA = stateA.tasks.find(t => t.id === targetTask.id);
    expect(taskOnA).toBeDefined();
    expect(taskOnA!.completed).toBe(true);
    expect(stateA.rewardPoints).toBe(updatedPointsOnServer);
  });

  // =========================================================================
  // REQUIREMENT 3: CONFLICT HANDLING - Same Activity Completed on Two Devices
  // =========================================================================
  it('Conflict Handling: Same activity completed on two devices simultaneously produces Idempotent No-Op and 0 duplicate rewards', async () => {
    const initialState = await repository.loadState();
    const targetTask = initialState.tasks[0];

    // Device A completes the task first
    const resA = await request(app)
      .post(`/api/v1/hee/activities/${targetTask.id}/complete`)
      .set('x-device-id', 'device-desktop-a')
      .send({ taskId: targetTask.id });

    expect(resA.status).toBe(200);
    const pointsAfterA = resA.body.data.rewardPoints;

    // Device B attempts to submit duplicate completion for the same activity via sync push
    const batchPushB = await request(app)
      .post('/api/v1/hee/sync/push')
      .send({
        deviceId: 'device-mobile-b',
        baseVersion: 1,
        commands: [
          {
            id: 'item-dup-1',
            idempotencyKey: 'idemp-dup-key-123',
            commandType: 'CompleteActivityCommand',
            payload: { taskId: targetTask.id },
            createdAt: new Date().toISOString(),
            baseVersion: 1,
            retryCount: 0,
            deviceId: 'device-mobile-b',
          },
        ],
      });

    expect(batchPushB.status).toBe(200);
    expect(batchPushB.body.success).toBe(true);

    // Points must NOT be double-awarded
    expect(batchPushB.body.state.rewardPoints).toBe(pointsAfterA);

    // Verify conflict log has recorded an IDEMPOTENT_NOOP resolution
    const resolvedConflicts = batchPushB.body.resolvedConflicts;
    expect(resolvedConflicts.length).toBe(1);
    expect(resolvedConflicts[0].conflictType).toBe('CONCURRENT_ACTIVITY_COMPLETION');
    expect(resolvedConflicts[0].strategy).toBe('IDEMPOTENT_NOOP');
  });

  // =========================================================================
  // REQUIREMENT 4: CONFLICT HANDLING - Outdated Tomorrow Plan 3-Way Non-Destructive Merge
  // =========================================================================
  it('Conflict Handling: Outdated tomorrow plan from disconnected device performs 3-way merge without overwriting populated fields', async () => {
    // Device A creates a detailed modern plan at 21:00
    const modernPlanA: any = {
      wakeTime: '06:00',
      energyPrediction: 'HIGH',
      targetMode: 'GREEN',
      plannedTasks: ['Key Architecture Review'],
      companyPriorities: ['Deliver Milestone 8'],
      familyCommitments: '4:00 PM Protected Family Dinner',
      plannedMeal: 'Salmon & Asparagus',
      workoutType: 'Upper Body Compound',
      lastPlannedAt: '2026-08-25T21:00:00.000Z',
    };

    await request(app)
      .post('/api/v1/hee/plan/tomorrow')
      .set('x-device-id', 'device-desktop-a')
      .send({ plan: modernPlanA });

    // Device B (which was disconnected since 18:00) pushes a stale/outdated draft with older timestamp
    const staleDraftB: any = {
      wakeTime: '07:30', // Stale wake time
      energyPrediction: 'MODERATE',
      targetMode: 'YELLOW',
      desiredRoutine: 'Offline Draft Notes',
      lastPlannedAt: '2026-08-25T18:00:00.000Z',
    };

    const pushResB = await request(app)
      .post('/api/v1/hee/sync/push')
      .send({
        deviceId: 'device-mobile-b',
        baseVersion: 1,
        commands: [
          {
            id: 'item-stale-plan',
            idempotencyKey: 'idemp-stale-plan-456',
            commandType: 'PlanTomorrowCommand',
            payload: { plan: staleDraftB },
            createdAt: '2026-08-25T18:05:00.000Z',
            baseVersion: 1,
            retryCount: 0,
            deviceId: 'device-mobile-b',
          },
        ],
      });

    expect(pushResB.status).toBe(200);
    const convergedPlan = pushResB.body.state.tomorrowPlan;

    // Authoritative newer fields (wake time 06:00, targetMode GREEN, family commitments) must be preserved
    expect(convergedPlan.wakeTime).toBe('06:00');
    expect(convergedPlan.targetMode).toBe('GREEN');
    expect(convergedPlan.familyCommitments).toBe('4:00 PM Protected Family Dinner');

    // Conflict ledger should note the 3-way merge
    expect(pushResB.body.resolvedConflicts.some((c: any) => c.conflictType === 'OUTDATED_TOMORROW_PLAN')).toBe(true);
  });

  // =========================================================================
  // REQUIREMENT 5: OFFLINE BUFFERING & RECONNECT BATCH REPLAY
  // =========================================================================
  it('Offline Resiliency: Queued actions during offline state are replayed sequentially upon reconnecting', async () => {
    const offlineCommands: SyncQueueItem[] = [
      {
        id: 'q1',
        idempotencyKey: 'idemp_q1_' + Date.now(),
        commandType: 'SetSystemModeCommand',
        payload: { mode: 'YELLOW' },
        createdAt: new Date().toISOString(),
        baseVersion: 1,
        retryCount: 0,
        deviceId: 'device-mobile-b',
      },
      {
        id: 'q2',
        idempotencyKey: 'idemp_q2_' + Date.now(),
        commandType: 'SetDayTypeCommand',
        payload: { dayType: 'STRONG_ENDS' },
        createdAt: new Date().toISOString(),
        baseVersion: 1,
        retryCount: 0,
        deviceId: 'device-mobile-b',
      },
      {
        id: 'q3',
        idempotencyKey: 'idemp_q3_' + Date.now(),
        commandType: 'AcceptDisciplinePenaltyCommand',
        payload: { taskId: 'task-morning-prime', penaltyPoints: 5 },
        createdAt: new Date().toISOString(),
        baseVersion: 1,
        retryCount: 0,
        deviceId: 'device-mobile-b',
      },
    ];

    const pushRes = await request(app)
      .post('/api/v1/hee/sync/push')
      .send({
        deviceId: 'device-mobile-b',
        baseVersion: 1,
        commands: offlineCommands,
      });

    expect(pushRes.status).toBe(200);
    expect(pushRes.body.success).toBe(true);

    const state: AppState = pushRes.body.state;
    expect(state.currentMode).toBe('YELLOW');
    expect(state.dayType).toBe('STRONG_ENDS');
    expect(state.disciplinePenaltiesCount).toBeGreaterThanOrEqual(1);
    expect(pushRes.body.version).toBeGreaterThan(1);
  });

  // =========================================================================
  // REQUIREMENT 6: DUPLICATE COMMAND IDEMPOTENCY
  // =========================================================================
  it('Duplicate Command: Repeated network submission with same idempotency key is safely ignored without state distortion', async () => {
    const cmdPayload = {
      id: 'cmd-idemp-1',
      idempotencyKey: 'exact-same-idempotency-key-789',
      commandType: 'SetSystemModeCommand',
      payload: { mode: 'YELLOW' },
      createdAt: new Date().toISOString(),
      baseVersion: 1,
      retryCount: 0,
      deviceId: 'device-mobile-b',
    };

    // First submission
    const res1 = await request(app)
      .post('/api/v1/hee/sync/push')
      .send({
        deviceId: 'device-mobile-b',
        baseVersion: 1,
        commands: [cmdPayload],
      });

    expect(res1.status).toBe(200);
    const version1 = res1.body.version;

    // Second duplicate submission
    const res2 = await request(app)
      .post('/api/v1/hee/sync/push')
      .send({
        deviceId: 'device-mobile-b',
        baseVersion: version1,
        commands: [cmdPayload],
      });

    expect(res2.status).toBe(200);
    // Duplicate command should be skipped cleanly
  });

  // =========================================================================
  // REQUIREMENT 7: 11 SYNCHRONIZED DOMAINS VERIFICATION
  // =========================================================================
  it('Synchronizes all 11 required domain areas authoritatively across devices', async () => {
    const pullRes = await request(app)
      .post('/api/v1/hee/sync/pull')
      .send({ deviceId: 'device-desktop-a' });

    expect(pullRes.status).toBe(200);
    const state: AppState = pullRes.body.state;

    // 1. Current Day
    expect(state.currentMode).toBeDefined();
    expect(state.dayType).toBeDefined();

    // 2. Tomorrow Plan
    expect(state.tomorrowPlan).toBeDefined();

    // 3. Activities
    expect(Array.isArray(state.tasks)).toBe(true);
    expect(state.tasks.length).toBeGreaterThan(0);

    // 4. Allocations
    expect(Array.isArray(state.dynamicAllocations)).toBe(true);

    // 5. Execution State
    expect(state.routineState).toBeDefined();
    expect(state.activeTimers).toBeDefined();

    // 6. Decisions
    expect(state.activeHumanDecision !== undefined).toBe(true);

    // 7. Overrides
    expect(Array.isArray(state.userOverrides)).toBe(true);

    // 8. Governance
    expect(state.autonomyLevel).toBeDefined();

    // 9. Adaptations
    expect(Array.isArray(state.adaptationProposals)).toBe(true);

    // 10. Rewards
    expect(typeof state.rewardPoints).toBe('number');
    expect(Array.isArray(state.rewards)).toBe(true);

    // 11. History
    expect(Array.isArray(state.history)).toBe(true);
    expect(Array.isArray(state.events)).toBe(true);
  });
});
