import { describe, it, expect, beforeEach } from 'vitest';
import {
  createExecutionRepository,
  LocalExecutionRepository,
  InMemoryExecutionRepository,
  ProductionExecutionRepository,
  IUnitOfWork,
  IExecutionRepository
} from '../repositories';
import { ExecutionApplicationService } from '../services/executionApplicationService';
import { TestClock } from '../clock';
import { DEFAULT_APP_STATE } from '../data/defaultData';

describe('Sprint 3 — Repository Parity & Acceptance (Local vs Production DB)', () => {
  let localRepo: IUnitOfWork & IExecutionRepository;
  let prodRepo: IUnitOfWork & IExecutionRepository;
  let testClock: TestClock;

  beforeEach(() => {
    testClock = new TestClock('06:00');
    localRepo = createExecutionRepository('memory', JSON.parse(JSON.stringify(DEFAULT_APP_STATE)));
    prodRepo = createExecutionRepository('production-memory', JSON.parse(JSON.stringify(DEFAULT_APP_STATE)));
  });

  const repoTypes = [
    { name: 'Local In-Memory Repository', getRepo: () => localRepo },
    { name: 'Production Canonical Database Repository', getRepo: () => prodRepo },
  ];

  repoTypes.forEach(({ name, getRepo }) => {
    describe(`Domain Execution Parity under [${name}]`, () => {
      it('routine repository reads and updates system mode and day type identically', async () => {
        const repo = getRepo();
        expect(await repo.routine.getSystemMode()).toBe('GREEN');
        expect(await repo.routine.getDayType()).toBe('STANDARD');

        await repo.routine.setSystemMode('YELLOW');
        expect(await repo.routine.getSystemMode()).toBe('YELLOW');

        await repo.routine.setDayType('EARLY_DEPARTURE');
        expect(await repo.routine.getDayType()).toBe('EARLY_DEPARTURE');
      });

      it('activity repository loads definitions and updates tasks preserving state', async () => {
        const repo = getRepo();
        const defs = await repo.activity.getDefinitions();
        expect(defs.length).toBeGreaterThan(0);

        const tasks = await repo.activity.getTasks();
        expect(tasks.length).toBeGreaterThan(0);

        const firstTask = tasks[0];
        await repo.activity.updateTask({ ...firstTask, completed: true, completedAtMinutes: 335 });

        const updated = await repo.activity.getTaskById(firstTask.id);
        expect(updated?.completed).toBe(true);
        expect(updated?.completedAtMinutes).toBe(335);
      });

      it('dependency and fallback repositories manage policies and tiers correctly', async () => {
        const repo = getRepo();
        const deps = await repo.dependency.getDependencies();
        expect(deps.length).toBeGreaterThan(0);

        const policies = await repo.fallback.getPolicies();
        expect(policies.length).toBeGreaterThan(0);

        const firstPolicy = policies[0];
        await repo.fallback.updatePolicyTier(firstPolicy.activityId, 2);

        const updatedPolicy = await repo.fallback.getPolicyForActivity(firstPolicy.activityId);
        expect(updatedPolicy?.activeTierLevel).toBe(2);
      });

      it('deviation and intervention repositories record and resolve deviations', async () => {
        const repo = getRepo();
        await repo.deviation.recordDeviation({
          id: 'dev-test-1',
          timestamp: '2026-08-17T06:30:00Z',
          activityId: 'task-meditation',
          type: 'LATE',
          severity: 'MEDIUM',
          minutesDelayed: 15,
          likelyCause: 'Overslept',
          impactSummary: '15m schedule delay',
          isResolved: false,
          resolvedAutonomously: false,
        });

        const devs = await repo.deviation.getDeviations();
        expect(devs.some(d => d.id === 'dev-test-1')).toBe(true);

        await repo.deviation.resolveDeviation('dev-test-1', true);
        const resolved = await repo.deviation.getDeviationById('dev-test-1');
        expect(resolved?.isResolved).toBe(true);
        expect(resolved?.resolvedAutonomously).toBe(true);
      });

      it('governance and event repositories record overrides and system events', async () => {
        const repo = getRepo();
        expect(await repo.governance.getAutonomyLevel()).toBe(3);

        await repo.governance.setAutonomyLevel(4);
        expect(await repo.governance.getAutonomyLevel()).toBe(4);

        await repo.governance.recordUserOverride({
          id: 'ovr-test-1',
          timestamp: '2026-08-17T07:00:00Z',
          activityId: 'task-deep-work-build',
          overrideType: 'COMPRESS',
          reason: 'Meeting scheduled',
          previousState: { duration: 90 },
          newState: { duration: 45 },
        });

        const ovrs = await repo.governance.getUserOverrides();
        expect(ovrs.some(o => o.id === 'ovr-test-1')).toBe(true);

        await repo.event.appendEvent({
          event_id: 'evt-test-1',
          event_type: 'ActivityCompleted',
          event_version: '1.0',
          occurred_at: '2026-08-17T07:00:00Z',
          actor: 'USER',
          subject: 'task-awaken',
          scope: 'DOMAIN',
          payload: { points: 5 },
          metadata: { currentMinutes: 335, mode: 'GREEN', routineState: 'STANDARD' },
        });

        const evts = await repo.event.getEvents();
        expect(evts.some(e => e.event_id === 'evt-test-1')).toBe(true);
      });

      it('transaction pipeline and application service execute seamlessly on repository', async () => {
        const repo = getRepo();
        const appService = new ExecutionApplicationService(repo, testClock);

        // 1. Plan Tomorrow
        const planRes = await appService.planTomorrow({
          top3: ['Deep Architecture', 'Trading Prep', 'Family Walk'],
          scheduleFocus: 'Deep Architecture Focus',
          plannedMeal: 'Chicken and Rice',
          workoutType: 'Kettlebells',
          companyPriority: 'EOS v1',
          familyActivity: 'Evening Walk',
          tradingConditions: 'Bullish Trending',
        });
        expect(planRes.success).toBe(true);
        expect(planRes.state.tomorrowPlan.top3[0]).toBe('Deep Architecture');

        // 2. Start Activity
        const startRes = await appService.startActivity('task-meditation');
        expect(startRes.success).toBe(true);
        expect(startRes.events.some(e => e.event_type === 'ActivityStarted')).toBe(true);

        // 3. Complete Activity
        const compRes = await appService.completeActivity({ taskId: 'task-meditation' });
        expect(compRes.success).toBe(true);
        const task = compRes.state.tasks.find(t => t.id === 'task-meditation');
        expect(task?.completed).toBe(true);
      });
    });
  });
});
