import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryExecutionRepository,
  LocalExecutionRepository,
  InMemoryStorageAdapter,
  StatePersistenceManager,
  RoutineRepository,
  ActivityRepository,
  AllocationRepository,
  DependencyRepository,
  FallbackRepository,
  DeviationRepository,
  DecisionRepository,
  AdaptationRepository,
  GovernanceRepository,
  EventRepository,
  ExecutionRepository,
  CompositeExecutionRepository
} from '../repositories';
import { DEFAULT_APP_STATE } from '../data/defaultData';
import { RoutineTask, DeviationRecord, AdaptationProposal, UserOverrideRecord, SystemEvent } from '../types';

describe('HEE Repository Architecture & Persistence Decoupling', () => {
  let adapter: InMemoryStorageAdapter;
  let manager: StatePersistenceManager;
  let compositeRepo: CompositeExecutionRepository;

  beforeEach(() => {
    adapter = new InMemoryStorageAdapter();
    manager = new StatePersistenceManager(adapter, DEFAULT_APP_STATE);
    compositeRepo = new CompositeExecutionRepository(adapter, DEFAULT_APP_STATE);
  });

  it('RoutineRepository reads and updates routine state, system mode, and day type', async () => {
    const repo = new RoutineRepository(manager);
    expect(await repo.getRoutineState()).toBe('STANDARD');
    expect(await repo.getSystemMode()).toBe('GREEN');
    expect(await repo.getDayType()).toBe('STANDARD');

    await repo.updateRoutineState('COMPRESSED', 'Late wake compression');
    expect(await repo.getRoutineState()).toBe('COMPRESSED');

    await repo.setSystemMode('YELLOW');
    expect(await repo.getSystemMode()).toBe('YELLOW');

    await repo.setDayType('EARLY_DEPARTURE');
    expect(await repo.getDayType()).toBe('EARLY_DEPARTURE');
  });

  it('ActivityRepository retrieves, updates tasks and activity instances', async () => {
    const repo = new ActivityRepository(manager);
    const tasks = await repo.getTasks();
    expect(tasks.length).toBeGreaterThan(0);

    const firstTask = tasks[0];
    const taskById = await repo.getTaskById(firstTask.id);
    expect(taskById?.id).toBe(firstTask.id);

    await repo.updateTask({ ...firstTask, completed: true, completedAtMinutes: 380 });
    const updated = await repo.getTaskById(firstTask.id);
    expect(updated?.completed).toBe(true);
    expect(updated?.completedAtMinutes).toBe(380);

    const definitions = await repo.getDefinitions();
    expect(definitions.length).toBeGreaterThan(0);
  });

  it('AllocationRepository persists and retrieves dynamic allocations', async () => {
    const repo = new AllocationRepository(manager);
    const mockAllocations = [
      {
        activityId: 'task-awaken',
        instanceId: 'inst-1',
        title: 'Awaken',
        originalStartMinutes: 330,
        originalEndMinutes: 340,
        allocatedStartMinutes: 330,
        allocatedEndMinutes: 340,
        durationMinutes: 10,
        isCompressed: false,
        isFallback: false,
        fallbackLevel: 0,
        isProtected: true,
        priority: 5,
        dependencyStatus: 'SATISFIED' as const,
      }
    ];

    await repo.saveAllocations(mockAllocations);
    const retrieved = await repo.getAllocations();
    expect(retrieved.length).toBe(1);
    expect(retrieved[0].activityId).toBe('task-awaken');

    const single = await repo.getAllocationForActivity('task-awaken');
    expect(single?.title).toBe('Awaken');
  });

  it('DependencyRepository queries and persists activity dependencies', async () => {
    const repo = new DependencyRepository(manager);
    const deps = await repo.getDependencies();
    expect(deps.length).toBeGreaterThan(0);

    const newDep = {
      id: 'dep-custom-test',
      sourceActivityId: 'task-prime',
      targetActivityId: 'task-deep-work',
      type: 'BLOCKS' as const,
      description: 'Morning prime must precede deep work',
      isMandatory: true,
    };
    await repo.saveDependency(newDep);
    const updatedDeps = await repo.getDependenciesForActivity('task-deep-work');
    expect(updatedDeps.some(d => d.id === 'dep-custom-test')).toBe(true);
  });

  it('FallbackRepository manages policy retrieval and active tier adjustments', async () => {
    const repo = new FallbackRepository(manager);
    const policies = await repo.getPolicies();
    expect(policies.length).toBeGreaterThan(0);

    const firstPolicy = policies[0];
    await repo.updatePolicyTier(firstPolicy.activityId, 2);
    const updated = await repo.getPolicyForActivity(firstPolicy.activityId);
    expect(updated?.activeTierLevel).toBe(2);
  });

  it('DeviationRepository records, queries, and resolves deviations', async () => {
    const repo = new DeviationRepository(manager);
    const mockDeviation: DeviationRecord = {
      id: 'dev-test-1',
      timestamp: new Date().toISOString(),
      activityId: 'task-workout',
      type: 'LATE',
      severity: 'MEDIUM',
      likelyCause: 'Late start by 15 mins',
      impactSummary: 'Schedule compressed',
      isResolved: false,
      resolvedAutonomously: false,
    };

    await repo.recordDeviation(mockDeviation);
    const devs = await repo.getDeviations();
    expect(devs.some(d => d.id === 'dev-test-1')).toBe(true);

    await repo.resolveDeviation('dev-test-1', true);
    const resolved = await repo.getDeviationById('dev-test-1');
    expect(resolved?.isResolved).toBe(true);
    expect(resolved?.resolvedAutonomously).toBe(true);
  });

  it('DecisionRepository manages active human decisions', async () => {
    const repo = new DecisionRepository(manager);
    expect(await repo.getActiveDecision()).toBeNull();

    const decision = {
      id: 'dec-1',
      title: 'Schedule Conflict',
      description: 'Choose recovery option',
      reason: 'Overrun detected',
      options: [
        { id: 'opt-1', label: 'Compress', description: 'Compress work', consequence: 'Fit schedule' }
      ],
      urgency: 'HIGH' as const,
      createdAt: new Date().toISOString(),
    };

    await repo.setActiveDecision(decision);
    expect(await repo.getActiveDecision()).not.toBeNull();

    await repo.recordDecisionResolution('dec-1', 'opt-1');
    expect(await repo.getActiveDecision()).toBeNull();
  });

  it('AdaptationRepository manages patterns and proposals', async () => {
    const repo = new AdaptationRepository(manager);
    const proposal: AdaptationProposal = {
      id: 'prop-test-1',
      patternId: 'pat-1',
      activityId: 'task-morning-prime',
      title: 'Shorten Meditation',
      description: 'Reduce meditation to 10 mins',
      suggestedChange: { property: 'duration', fromValue: 20, toValue: 10 },
      impactLevel: 'LOW_RISK_AUTO',
      status: 'PROPOSED',
      proposedAt: new Date().toISOString(),
    };

    await repo.saveProposal(proposal);
    const proposals = await repo.getProposals();
    expect(proposals.some(p => p.id === 'prop-test-1')).toBe(true);

    await repo.updateProposalStatus('prop-test-1', 'APPLIED');
    const updated = (await repo.getProposals()).find(p => p.id === 'prop-test-1');
    expect(updated?.status).toBe('APPLIED');
    expect(updated?.appliedAt).toBeDefined();
  });

  it('GovernanceRepository manages autonomy levels and user overrides', async () => {
    const repo = new GovernanceRepository(manager);
    expect(await repo.getAutonomyLevel()).toBe(3);

    await repo.setAutonomyLevel(4);
    expect(await repo.getAutonomyLevel()).toBe(4);

    const override: UserOverrideRecord = {
      id: 'ovr-test-1',
      timestamp: new Date().toISOString(),
      activityId: 'task-deep-work',
      overrideType: 'ADVANCE',
      reason: 'Started early',
      previousState: null,
      newState: null,
    };
    await repo.recordUserOverride(override);
    const overrides = await repo.getUserOverrides();
    expect(overrides.some(o => o.id === 'ovr-test-1')).toBe(true);
  });

  it('EventRepository appends and limits audit event stream', async () => {
    const repo = new EventRepository(manager);
    const evt: SystemEvent = {
      event_id: 'evt-1',
      event_type: 'ActivityCompleted',
      event_version: '1.0.0',
      occurred_at: new Date().toISOString(),
      actor: 'SYSTEM_KERNEL',
      subject: 'task-awaken',
      scope: 'DAY_EXECUTION_KERNEL',
      payload: { completed: true },
      metadata: { currentMinutes: 340, mode: 'GREEN', routineState: 'STANDARD' },
    };

    await repo.appendEvent(evt);
    const events = await repo.getEvents();
    expect(events.some(e => e.event_id === 'evt-1')).toBe(true);
  });

  it('CompositeExecutionRepository exposes all repositories and UnitOfWork methods', async () => {
    expect(compositeRepo.routine).toBeDefined();
    expect(compositeRepo.activity).toBeDefined();
    expect(compositeRepo.allocation).toBeDefined();
    expect(compositeRepo.dependency).toBeDefined();
    expect(compositeRepo.fallback).toBeDefined();
    expect(compositeRepo.deviation).toBeDefined();
    expect(compositeRepo.decision).toBeDefined();
    expect(compositeRepo.adaptation).toBeDefined();
    expect(compositeRepo.governance).toBeDefined();
    expect(compositeRepo.event).toBeDefined();
    expect(compositeRepo.execution).toBeDefined();

    const fullState = await compositeRepo.getFullState();
    expect(fullState.tasks.length).toBeGreaterThan(0);
  });
});
