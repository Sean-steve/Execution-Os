import { describe, it, expect, beforeEach } from 'vitest';
import {
  CanonicalDatabase,
  InMemoryCanonicalStorageEngine,
  OptimisticLockError,
  EntityNotFoundError,
  InvariantViolationError
} from '../canonical/canonicalDatabase';
import { EntityMapper } from '../canonical/entityMapper';
import { DEFAULT_APP_STATE } from '../data/defaultData';
import { AppState, RoutineTask } from '../types';

describe('Sprint 3 — Canonical Data Model & Invariants (EOS-003, EOS-005, EOS-007, EOS-014)', () => {
  let db: CanonicalDatabase;
  let mapper: EntityMapper;

  beforeEach(async () => {
    db = new CanonicalDatabase(new InMemoryCanonicalStorageEngine());
    mapper = new EntityMapper('user_primary', 'America/Los_Angeles');
    await db.initialize();
  });

  it('Invariant 1: Definitions != instances separation', async () => {
    const canonical = mapper.appStateToCanonical(DEFAULT_APP_STATE);
    await db.restoreSnapshot(canonical);

    // Definitions live in activity_definitions & routine_definitions
    const definitions = await db.findMany<any>('activity_definitions');
    const instances = await db.findMany<any>('activity_instances');

    expect(definitions.length).toBeGreaterThan(0);
    expect(instances.length).toBeGreaterThan(0);

    // Definitions hold intrinsic requirements (energy, focus, prerequisites)
    const tradingDef = definitions.find((d: any) => d.id === 'act-def-trading-protocol');
    expect(tradingDef).toBeDefined();
    expect(tradingDef.focusRequirement).toBe('HIGH');
    expect(tradingDef.priority).toBe(4);

    // Instances hold execution facts (actual times, completion state, fallback level, notes)
    const awakenInst = instances.find((i: any) => i.activityDefinitionId === 'task-awaken');
    expect(awakenInst).toBeDefined();
    expect(awakenInst.completed).toBe(false);
    expect(awakenInst.date).toBeDefined();
  });

  it('Invariant 2: Allocations != execution history separation', async () => {
    const testState: AppState = JSON.parse(JSON.stringify(DEFAULT_APP_STATE));
    testState.tasks[0].completed = true;
    testState.tasks[0].completedAtMinutes = 332;
    testState.dynamicAllocations = [
      {
        activityId: 'task-awaken',
        instanceId: 'inst_task-awaken',
        title: 'Arise & Identity Reset',
        originalStartMinutes: 330,
        originalEndMinutes: 335,
        allocatedStartMinutes: 330,
        allocatedEndMinutes: 335,
        durationMinutes: 5,
        isCompressed: false,
        isFallback: false,
        fallbackLevel: 0,
        isProtected: true,
        priority: 5,
        dependencyStatus: 'SATISFIED',
      }
    ];

    const canonical = mapper.appStateToCanonical(testState);
    await db.restoreSnapshot(canonical);

    const allocations = await db.findMany<any>('allocations');
    const evidences = await db.findMany<any>('execution_evidences');

    expect(allocations.length).toBe(1);
    expect(evidences.length).toBeGreaterThan(0);

    // Allocations are mutable schedule projections
    expect(allocations[0].activityDefinitionId).toBe('task-awaken');
    // Execution evidences are immutable factual execution records
    expect(evidences[0].id).toBeDefined();
    expect(evidences[0].verifiedAtUtc).toBeDefined();
  });

  it('Invariant 3: Replanning must NEVER overwrite historical execution facts', async () => {
    const testState: AppState = JSON.parse(JSON.stringify(DEFAULT_APP_STATE));
    // Complete first task in the morning
    testState.tasks[0].completed = true;
    testState.tasks[0].completedAtMinutes = 334;
    testState.history.push({
      date: '2026-08-16',
      score: 6,
      mode: 'GREEN',
      dayType: 'STANDARD',
      pillars: { morning: true, body: true, mission: true, business: true, wealthTrading: true, family: true, eveningShutdown: false }
    });

    const canonical1 = mapper.appStateToCanonical(testState);
    await db.restoreSnapshot(canonical1);

    // Now perform a dramatic mid-day replanning (e.g. Red Mode compression)
    testState.currentMode = 'RED';
    testState.routineState = 'COMPRESSED';
    testState.tasks = testState.tasks.map(t =>
      t.id === 'task-workout-morning' ? { ...t, executionStatus: 'COMPRESSED', fallbackLevel: 1 } : t
    );

    const canonical2 = mapper.appStateToCanonical(testState);
    await db.restoreSnapshot(canonical2);

    // Assert that historical day logs and already completed task facts remain intact
    const histories = await db.findMany('day_histories');
    expect(histories.length).toBe(testState.history.length);
    expect(histories.some((h: any) => h.date === '2026-08-16')).toBe(true);

    const completedInst = await db.findMany('activity_instances', (i: any) => i.activityDefinitionId === 'task-awaken');
    expect(completedInst[0].completed).toBe(true);
    expect(completedInst[0].actualStartMinutes).toBe(334);
  });

  it('Invariant 4: Every mutable aggregate supports version & concurrency protection', async () => {
    const canonical = mapper.appStateToCanonical(DEFAULT_APP_STATE);
    await db.restoreSnapshot(canonical);

    const profile = await db.findById<any>('profiles', 'profile_user_primary');
    expect(profile).toBeDefined();
    expect(profile.version).toBe(1);

    // Update with correct expected version succeeds and increments version to 2
    const updated = await db.update<any>(
      'profiles',
      'profile_user_primary',
      p => {
        p.currentMode = 'YELLOW';
      },
      1
    );
    expect(updated.version).toBe(2);
    expect(updated.currentMode).toBe('YELLOW');

    // Attempting update with stale expected version throws OptimisticLockError
    await expect(
      db.update<any>(
        'profiles',
        'profile_user_primary',
        p => {
          p.currentMode = 'RED';
        },
        1 // Stale expected version!
      )
    ).rejects.toThrow(OptimisticLockError);
  });

  it('Invariant 5: Every user-owned record is scoped to its owner (userId)', async () => {
    const canonical = mapper.appStateToCanonical(DEFAULT_APP_STATE);
    await db.restoreSnapshot(canonical);

    const tables = [
      'profiles',
      'routine_definitions',
      'activity_definitions',
      'activity_instances',
      'dependencies',
      'fallback_policies',
      'adaptation_proposals',
      'governance_policies',
      'reward_definitions'
    ] as const;

    for (const table of tables) {
      const records = await db.findMany<any>(table);
      expect(records.length).toBeGreaterThan(0);
      for (const record of records) {
        expect(record.userId).toBe('user_primary');
      }
    }
  });

  it('Invariant 6: UTC persistence plus explicit user timezone', async () => {
    const canonical = mapper.appStateToCanonical(DEFAULT_APP_STATE);
    await db.restoreSnapshot(canonical);

    const profile = await db.findById<any>('profiles', 'profile_user_primary');
    expect(profile.timezone).toBe('America/Los_Angeles');
    expect(profile.createdAtUtc).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(profile.updatedAtUtc).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const events = await db.findMany<any>('event_records');
    for (const evt of events) {
      expect(evt.occurred_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });
});
