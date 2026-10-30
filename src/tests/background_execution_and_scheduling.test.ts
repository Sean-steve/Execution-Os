import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/createApp';
import { InMemoryExecutionRepository } from '../repositories/implementations';
import { DEFAULT_APP_STATE } from '../data/defaultData';
import { reconcileLifecycleState } from '../services/reconciliationEngine';
import { BackgroundWorker } from '../services/backgroundWorker';
import { IClock } from '../clock';
import { AppState, BackgroundJobRecord, TomorrowPlan } from '../types';

class MockDeterministicClock implements IClock {
  private currentTime: string;
  private currentMinutes: number;
  private currentDate: string;

  constructor(date: string = '2026-08-24', time: string = '08:30', minutes: number = 510) {
    this.currentDate = date;
    this.currentTime = time;
    this.currentMinutes = minutes;
  }

  setTime(date: string, time: string, minutes: number) {
    this.currentDate = date;
    this.currentTime = time;
    this.currentMinutes = minutes;
  }

  now(): Date {
    return new Date(`${this.currentDate}T${this.currentTime}:00.000Z`);
  }

  toISOString(): string {
    return `${this.currentDate}T${this.currentTime}:00.000Z`;
  }

  getCurrentTimeMinutes(): number {
    return this.currentMinutes;
  }

  getTimeString(): string {
    return this.currentTime;
  }

  formatTime12Hour(): string {
    const hours = Math.floor(this.currentMinutes / 60);
    const mins = this.currentMinutes % 60;
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 === 0 ? 12 : hours % 12;
    return `${displayHours}:${mins < 10 ? '0' : ''}${mins} ${period}`;
  }

  getISODate(): string {
    return this.currentDate;
  }
}

describe('Sprint 7 (EOS-014): Background Execution & Governed Scheduling', () => {
  let repository: InMemoryExecutionRepository;
  let clock: MockDeterministicClock;

  beforeEach(() => {
    repository = new InMemoryExecutionRepository(JSON.parse(JSON.stringify(DEFAULT_APP_STATE)));
    clock = new MockDeterministicClock('2026-08-24', '05:30', 330);
  });

  it('verifies all 9 governed background jobs are registered, user-scoped, and idempotent', async () => {
    const state = await repository.loadState();
    expect(state.scheduler).toBeDefined();
    expect(state.scheduler?.jobs.length).toBe(9);

    const jobTypes = state.scheduler?.jobs.map(j => j.type);
    expect(jobTypes).toContain('DAY_BOUNDARY_TRANSITION');
    expect(jobTypes).toContain('DAY_ACTIVATION');
    expect(jobTypes).toContain('TOMORROW_PLAN_EVALUATION');
    expect(jobTypes).toContain('SCHEDULED_EXECUTION_EVALUATION');
    expect(jobTypes).toContain('EXPIRED_ALLOCATION_DETECTION');
    expect(jobTypes).toContain('TIME_SENSITIVE_DECISION');
    expect(jobTypes).toContain('NOTIFICATION_GENERATION');
    expect(jobTypes).toContain('ADAPTATION_PROCESSING');
    expect(jobTypes).toContain('MAINTENANCE_CLEANUP');

    // Verify all are idempotent and user-scoped
    for (const job of state.scheduler?.jobs || []) {
      expect(job.isIdempotent).toBe(true);
      expect(job.userScoped).toBe(true);
    }
  });

  it('reconciles Day Boundary Transition by archiving yesterday and activating today', async () => {
    const initialState = await repository.loadState();
    initialState.activeDate = '2026-08-23';
    initialState.victoryQuestionAnswer = 'Closed major enterprise contract';
    initialState.history = [];

    // Advance clock to new date 2026-08-24 at 05:30 AM
    clock.setTime('2026-08-24', '05:30', 330);

    const { state, result, events } = reconcileLifecycleState(initialState, clock);

    expect(result.dayBoundaryCrossed).toBe(true);
    expect(result.dayActivated).toBe(true);
    expect(state.activeDate).toBe('2026-08-24');
    expect(state.history.length).toBe(1);
    expect(state.history[0].date).toBe('2026-08-23');
    expect(state.history[0].topVictory).toBe('Closed major enterprise contract');

    // Verify events emitted
    const boundaryEvt = events.find(e => e.event_type === 'DayBoundaryCrossed');
    expect(boundaryEvt).toBeDefined();
    expect(boundaryEvt?.payload.previousDate).toBe('2026-08-23');
    expect(boundaryEvt?.payload.newDate).toBe('2026-08-24');

    // Verify day activation notification
    expect(state.notifications?.some(n => n.type === 'DAY_ACTIVATION')).toBe(true);
  });

  it('satisfies the Primary Offline Scenario: User plans tomorrow at 9 PM -> closes app -> sleeps -> opens at 8:30 AM next day', async () => {
    // 1. User plans tomorrow at 9:00 PM (Day 1)
    const day1State = await repository.loadState();
    day1State.activeDate = '2026-08-23';
    day1State.tomorrowPlan = {
      scheduleFocus: 'Deep Infrastructure Delivery',
      plannedMeal: 'Keto Salmon and Greens',
      workoutType: 'Full Body Conditioning',
      companyPriority: 'Ship Sprint 7 background worker',
      familyActivity: 'Dinner & unhurried reading',
      tradingConditions: 'Zero risk, rules strictly satisfied',
      desiredWakeTime: '05:30',
      desiredWakeMinutes: 330,
      definitionOfVictory: '100% test coverage and background worker operational',
      top3: ['Build Background Worker', 'Implement Reconciliation', 'Pass all integration suites'],
    };

    // 2. Browser tab closes (State safely persisted in repository)
    await repository.saveState(day1State);

    // 3. User sleeps, midnight passes, user opens app at 8:30 AM (510 min) on 2026-08-24 (Day 2)
    const day2Clock = new MockDeterministicClock('2026-08-24', '08:30', 510);
    const worker = new BackgroundWorker(repository, day2Clock);

    const { state: reconciledState, result } = await worker.tick();

    // 4. Verification of durable reconciliation
    expect(result.dayBoundaryCrossed).toBe(true);
    expect(result.dayActivated).toBe(true);
    expect(result.lateWakeDetected).toBe(true);
    expect(result.lateWakeDriftMinutes).toBe(180); // 510 (8:30) - 330 (5:30) = 180m drift
    expect(reconciledState.activeDate).toBe('2026-08-24');

    // Yesterday was archived
    expect(reconciledState.history.some(h => h.date === '2026-08-23')).toBe(true);

    // Morning anchors compressed to tier fallbacks to protect 4:00 PM family boundary
    expect(reconciledState.routineState).toBeDefined();

    // Notifications generated for both day activation and late wake compression
    expect(reconciledState.notifications?.some(n => n.type === 'DAY_ACTIVATION')).toBe(true);
    expect(reconciledState.notifications?.some(n => n.type === 'RECOVERY')).toBe(true);
  });

  it('detects expired allocations and logs deviations for missed task windows past 5-min grace period', async () => {
    const state = await repository.loadState();
    state.activeDate = '2026-08-24';
    state.tasks = [
      {
        id: 'task-early-deep-work',
        anchorId: 'ANCHOR_5_DEEPWORK_BUILD',
        title: 'Deep Work Block 1',
        timeWindow: '07:30 - 08:30',
        associatedPillar: 'mission',
        startMinutes: 450, // 07:30 AM
        endMinutes: 510,   // 08:30 AM
        allocatedStartMinutes: 450,
        allocatedEndMinutes: 510,
        completed: false,
        isNonNegotiable: true,
        modesAllowed: ['GREEN', 'YELLOW', 'RED'],
        fallbackLevel: 1,
      },
    ];

    // Clock is at 08:40 AM (520m, 10 min past end time)
    clock.setTime('2026-08-24', '08:40', 520);

    const { state: reconciledState, result } = reconcileLifecycleState(state, clock);

    expect(result.expiredAllocationsCount).toBe(1);
    expect(result.expiredTasksMarked).toContain('task-early-deep-work');

    const task = reconciledState.tasks.find(t => t.id === 'task-early-deep-work');
    expect(task?.executionStatus).toBe('MISSED_LATE');
    expect(task?.missedWindow).toBe(true);

    // Deviation logged
    expect(reconciledState.deviations.some(d => d.activityId === 'task-early-deep-work')).toBe(true);
  });

  it('generates contextual proactive reminders (15-min warning before Protected Family Time)', async () => {
    const state = await repository.loadState();
    state.activeDate = '2026-08-24';
    state.notifications = [];

    // Clock at 15:50 (950m, 10 minutes before 16:00 / 960m family start)
    clock.setTime('2026-08-24', '15:50', 950);

    const { state: reconciledState, result } = reconcileLifecycleState(state, clock);

    expect(result.notificationsGenerated).toBeGreaterThan(0);
    const familyNotif = reconciledState.notifications?.find(n => n.id.includes('notif-family-prep'));
    expect(familyNotif).toBeDefined();
    expect(familyNotif?.title).toContain('Protected Family Time');
  });

  it('guarantees idempotence when tick is executed multiple times with identical clock', async () => {
    const initialState = await repository.loadState();
    initialState.activeDate = '2026-08-24';

    clock.setTime('2026-08-24', '10:00', 600);

    // Run tick 3 times
    const run1 = reconcileLifecycleState(initialState, clock);
    const run2 = reconcileLifecycleState(run1.state, clock);
    const run3 = reconcileLifecycleState(run2.state, clock);

    expect(run3.state.history.length).toBe(run1.state.history.length);
    expect(run3.result.dayBoundaryCrossed).toBe(false);
    expect(run3.result.dayActivated).toBe(false);
    expect(run3.state.activeDate).toBe('2026-08-24');
  });

  it('exposes full REST API suite for background execution and offline simulations', async () => {
    const app = createApp({ repository, clock });

    // 1. GET /api/v1/hee/scheduler/status
    const statusRes = await request(app)
      .get('/api/v1/hee/scheduler/status')
      .expect(200);

    expect(statusRes.body.success).toBe(true);
    expect(statusRes.body.data.enabled).toBeDefined();
    expect(statusRes.body.data.schedulerState.jobs.length).toBe(9);

    // 2. POST /api/v1/hee/scheduler/tick
    const tickRes = await request(app)
      .post('/api/v1/hee/scheduler/tick')
      .send({ forceDayBoundary: false })
      .expect(200);

    expect(tickRes.body.success).toBe(true);
    expect(tickRes.body.data.result).toBeDefined();

    // 3. POST /api/v1/hee/scheduler/run-job
    const runJobRes = await request(app)
      .post('/api/v1/hee/scheduler/run-job')
      .send({ jobType: 'MAINTENANCE_CLEANUP' })
      .expect(200);

    expect(runJobRes.body.success).toBe(true);
    expect(runJobRes.body.data.jobType).toBe('MAINTENANCE_CLEANUP');

    // 4. POST /api/v1/hee/scheduler/toggle
    const toggleRes = await request(app)
      .post('/api/v1/hee/scheduler/toggle')
      .send({ enabled: true })
      .expect(200);

    expect(toggleRes.body.success).toBe(true);
    expect(toggleRes.body.data.enabled).toBe(true);

    // 5. GET /api/v1/hee/scheduler/notifications
    const notifRes = await request(app)
      .get('/api/v1/hee/scheduler/notifications')
      .expect(200);

    expect(notifRes.body.success).toBe(true);
    expect(Array.isArray(notifRes.body.data.notifications)).toBe(true);

    // 6. POST /api/v1/hee/scheduler/simulate-offline
    const simRes = await request(app)
      .post('/api/v1/hee/scheduler/simulate-offline')
      .send({ wakeMinutes: 510, newDate: '2026-08-25' })
      .expect(200);

    expect(simRes.body.success).toBe(true);
    expect(simRes.body.data.reconciliation.dayBoundaryCrossed).toBe(true);
    expect(simRes.body.data.state.activeDate).toBe('2026-08-25');
  });
});
