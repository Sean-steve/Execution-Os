import {
  AppState,
  RoutineState,
  SystemMode,
  DayType,
  RoutineTask,
  ActivityDefinition,
  ActivityInstance,
  DynamicAllocation,
  ActivityDependency,
  FallbackPolicy,
  DeviationRecord,
  InterventionRecord,
  AdaptationPattern,
  AdaptationProposal,
  UserOverrideRecord,
  HumanDecisionRequest,
  SystemEvent,
  AutonomyLevel
} from '../types';
import { RUNTIME_INITIAL_STATE } from '../data/runtimeInitialState';
import { RUNTIME_INITIAL_STATE } from '../data/defaultData';
import {
  IRoutineRepository,
  IActivityRepository,
  IAllocationRepository,
  IDependencyRepository,
  IFallbackRepository,
  IDeviationRepository,
  IDecisionRepository,
  IAdaptationRepository,
  IGovernanceRepository,
  IEventRepository,
  IExecutionRepository,
  IUnitOfWork,
  IStorageAdapter
} from './interfaces';

const STORAGE_KEY = 'autonomous_execution_os_v1';

export class BrowserLocalStorageAdapter implements IStorageAdapter {
  getItem(key: string): string | null {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem(key);
      }
    } catch (e) {
      console.warn('LocalStorage read error:', e);
    }
    return null;
  }

  setItem(key: string, value: string): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(key, value);
      }
    } catch (e) {
      console.warn('LocalStorage write error:', e);
    }
  }

  removeItem(key: string): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(key);
      }
    } catch (e) {
      console.warn('LocalStorage remove error:', e);
    }
  }
}

export class InMemoryStorageAdapter implements IStorageAdapter {
  private map: Map<string, string> = new Map();

  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }
}

/**
 * StatePersistenceManager: Core state reader/writer that coordinates persistence across repositories
 */
export class StatePersistenceManager {
  private adapter: IStorageAdapter;
  private cachedState: AppState | null = null;

  constructor(adapter: IStorageAdapter = new BrowserLocalStorageAdapter(), initialState?: AppState) {
    this.adapter = adapter;
    if (initialState) {
      this.cachedState = JSON.parse(JSON.stringify(initialState));
      this.adapter.setItem(STORAGE_KEY, JSON.stringify(this.cachedState));
    }
  }

  getState(): AppState {
    if (this.cachedState) {
      return JSON.parse(JSON.stringify(this.cachedState));
    }
    const raw = this.adapter.getItem(STORAGE_KEY);
    if (!raw) {
      this.cachedState = JSON.parse(JSON.stringify(RUNTIME_INITIAL_STATE));
      return JSON.parse(JSON.stringify(this.cachedState));
    }
    try {
      const parsed = JSON.parse(raw);
      this.cachedState = {
        ...RUNTIME_INITIAL_STATE,
        ...parsed,
        tasks: parsed.tasks?.length ? parsed.tasks : RUNTIME_INITIAL_STATE.tasks,
        activities: parsed.activities?.length ? parsed.activities : RUNTIME_INITIAL_STATE.activities,
        dependencies: parsed.dependencies?.length ? parsed.dependencies : RUNTIME_INITIAL_STATE.dependencies,
        fallbackPolicies: parsed.fallbackPolicies?.length ? parsed.fallbackPolicies : RUNTIME_INITIAL_STATE.fallbackPolicies,
        adaptationPatterns: parsed.adaptationPatterns?.length ? parsed.adaptationPatterns : RUNTIME_INITIAL_STATE.adaptationPatterns,
        adaptationProposals: parsed.adaptationProposals?.length ? parsed.adaptationProposals : RUNTIME_INITIAL_STATE.adaptationProposals,
        rewards: parsed.rewards?.length ? parsed.rewards : RUNTIME_INITIAL_STATE.rewards,
        pointsAwardedTasks: parsed.pointsAwardedTasks || [],
        activeTimers: parsed.activeTimers || RUNTIME_INITIAL_STATE.activeTimers,
        events: parsed.events || [],
        deviations: parsed.deviations || [],
        interventions: parsed.interventions || [],
        dynamicAllocations: parsed.dynamicAllocations || [],
        userOverrides: parsed.userOverrides || [],
        autonomousResolutionCount: parsed.autonomousResolutionCount ?? RUNTIME_INITIAL_STATE.autonomousResolutionCount,
        autonomyLevel: parsed.autonomyLevel ?? RUNTIME_INITIAL_STATE.autonomyLevel,
        routineState: parsed.routineState || 'STANDARD',
        activeDate: parsed.activeDate || RUNTIME_INITIAL_STATE.activeDate || new Date().toISOString().split('T')[0],
        timezone: parsed.timezone || RUNTIME_INITIAL_STATE.timezone || 'UTC',
        scheduler: parsed.scheduler || RUNTIME_INITIAL_STATE.scheduler,
        notifications: parsed.notifications || RUNTIME_INITIAL_STATE.notifications || [],
        version: parsed.version ?? 1,
        syncMetadata: parsed.syncMetadata || RUNTIME_INITIAL_STATE.syncMetadata,
        registeredDevices: parsed.registeredDevices || RUNTIME_INITIAL_STATE.registeredDevices,
        conflictLog: parsed.conflictLog || [],
      };
      return JSON.parse(JSON.stringify(this.cachedState));
    } catch (e) {
      console.error('Failed to parse state:', e);
      this.cachedState = JSON.parse(JSON.stringify(RUNTIME_INITIAL_STATE));
      return JSON.parse(JSON.stringify(this.cachedState));
    }
  }

  saveState(state: AppState): void {
    this.cachedState = JSON.parse(JSON.stringify(state));
    this.adapter.setItem(STORAGE_KEY, JSON.stringify(this.cachedState));
  }

  updateState(mutator: (draft: AppState) => void): AppState {
    const current = this.getState();
    mutator(current);
    this.saveState(current);
    return current;
  }

  reset(): AppState {
    this.cachedState = JSON.parse(JSON.stringify(RUNTIME_INITIAL_STATE));
    this.adapter.setItem(STORAGE_KEY, JSON.stringify(this.cachedState));
    return JSON.parse(JSON.stringify(this.cachedState));
  }
}

/**
 * RoutineRepository implementation
 */
export class RoutineRepository implements IRoutineRepository {
  constructor(private manager: StatePersistenceManager) {}

  async getRoutineState(): Promise<RoutineState> {
    return this.manager.getState().routineState;
  }

  async getSystemMode(): Promise<SystemMode> {
    return this.manager.getState().currentMode;
  }

  async getDayType(): Promise<DayType> {
    return this.manager.getState().dayType;
  }

  async updateRoutineState(state: RoutineState, reason?: string): Promise<void> {
    this.manager.updateState(draft => {
      draft.routineState = state;
      if (reason) draft.routineChangeReason = reason;
    });
  }

  async setSystemMode(mode: SystemMode): Promise<void> {
    this.manager.updateState(draft => {
      draft.currentMode = mode;
    });
  }

  async setDayType(dayType: DayType): Promise<void> {
    this.manager.updateState(draft => {
      draft.dayType = dayType;
    });
  }
}

/**
 * ActivityRepository implementation
 */
export class ActivityRepository implements IActivityRepository {
  constructor(private manager: StatePersistenceManager) {}

  async getDefinitions(): Promise<ActivityDefinition[]> {
    return this.manager.getState().activities || [];
  }

  async getDefinitionById(id: string): Promise<ActivityDefinition | null> {
    const defs = await this.getDefinitions();
    return defs.find(d => d.id === id) || null;
  }

  async getTasks(): Promise<RoutineTask[]> {
    return this.manager.getState().tasks || [];
  }

  async getTaskById(id: string): Promise<RoutineTask | null> {
    const tasks = await this.getTasks();
    return tasks.find(t => t.id === id) || null;
  }

  async updateTask(task: RoutineTask): Promise<void> {
    this.manager.updateState(draft => {
      draft.tasks = draft.tasks.map(t => (t.id === task.id ? { ...t, ...task } : t));
    });
  }

  async updateTasks(tasks: RoutineTask[]): Promise<void> {
    this.manager.updateState(draft => {
      draft.tasks = tasks;
    });
  }

  async getInstances(): Promise<ActivityInstance[]> {
    return this.manager.getState().activityInstances || [];
  }

  async getInstanceById(id: string): Promise<ActivityInstance | null> {
    const instances = await this.getInstances();
    return instances.find(i => i.id === id) || null;
  }

  async saveInstance(instance: ActivityInstance): Promise<void> {
    this.manager.updateState(draft => {
      const idx = draft.activityInstances.findIndex(i => i.id === instance.id);
      if (idx >= 0) {
        draft.activityInstances[idx] = instance;
      } else {
        draft.activityInstances.push(instance);
      }
    });
  }
}

/**
 * AllocationRepository implementation
 */
export class AllocationRepository implements IAllocationRepository {
  constructor(private manager: StatePersistenceManager) {}

  async getAllocations(): Promise<DynamicAllocation[]> {
    return this.manager.getState().dynamicAllocations || [];
  }

  async getAllocationForActivity(activityId: string): Promise<DynamicAllocation | null> {
    const allocs = await this.getAllocations();
    return allocs.find(a => a.activityId === activityId) || null;
  }

  async saveAllocations(allocations: DynamicAllocation[]): Promise<void> {
    this.manager.updateState(draft => {
      draft.dynamicAllocations = allocations;
    });
  }
}

/**
 * DependencyRepository implementation
 */
export class DependencyRepository implements IDependencyRepository {
  constructor(private manager: StatePersistenceManager) {}

  async getDependencies(): Promise<ActivityDependency[]> {
    return this.manager.getState().dependencies || [];
  }

  async getDependenciesForActivity(activityId: string): Promise<ActivityDependency[]> {
    const deps = await this.getDependencies();
    return deps.filter(d => d.sourceActivityId === activityId || d.targetActivityId === activityId);
  }

  async saveDependency(dep: ActivityDependency): Promise<void> {
    this.manager.updateState(draft => {
      const idx = draft.dependencies.findIndex(d => d.id === dep.id);
      if (idx >= 0) {
        draft.dependencies[idx] = dep;
      } else {
        draft.dependencies.push(dep);
      }
    });
  }
}

/**
 * FallbackRepository implementation
 */
export class FallbackRepository implements IFallbackRepository {
  constructor(private manager: StatePersistenceManager) {}

  async getPolicies(): Promise<FallbackPolicy[]> {
    return this.manager.getState().fallbackPolicies || [];
  }

  async getPolicyForActivity(activityId: string): Promise<FallbackPolicy | null> {
    const policies = await this.getPolicies();
    return policies.find(p => p.activityId === activityId) || null;
  }

  async updatePolicyTier(activityId: string, tierLevel: number): Promise<void> {
    this.manager.updateState(draft => {
      draft.fallbackPolicies = draft.fallbackPolicies.map(p =>
        p.activityId === activityId ? { ...p, activeTierLevel: tierLevel } : p
      );
    });
  }
}

/**
 * DeviationRepository implementation
 */
export class DeviationRepository implements IDeviationRepository {
  constructor(private manager: StatePersistenceManager) {}

  async getDeviations(): Promise<DeviationRecord[]> {
    return this.manager.getState().deviations || [];
  }

  async getDeviationById(id: string): Promise<DeviationRecord | null> {
    const devs = await this.getDeviations();
    return devs.find(d => d.id === id) || null;
  }

  async recordDeviation(deviation: DeviationRecord): Promise<void> {
    this.manager.updateState(draft => {
      const idx = draft.deviations.findIndex(d => d.id === deviation.id);
      if (idx >= 0) {
        draft.deviations[idx] = deviation;
      } else {
        draft.deviations = [deviation, ...draft.deviations].slice(0, 100);
      }
    });
  }

  async getInterventions(): Promise<InterventionRecord[]> {
    return this.manager.getState().interventions || [];
  }

  async recordIntervention(intervention: InterventionRecord): Promise<void> {
    this.manager.updateState(draft => {
      const idx = draft.interventions.findIndex(i => i.id === intervention.id);
      if (idx >= 0) {
        draft.interventions[idx] = intervention;
      } else {
        draft.interventions = [intervention, ...draft.interventions].slice(0, 100);
      }
    });
  }

  async resolveDeviation(id: string, autonomously: boolean): Promise<void> {
    this.manager.updateState(draft => {
      draft.deviations = draft.deviations.map(d =>
        d.id === id ? { ...d, isResolved: true, resolvedAutonomously: autonomously } : d
      );
      if (autonomously) {
        draft.autonomousResolutionCount = (draft.autonomousResolutionCount || 0) + 1;
      }
    });
  }
}

/**
 * DecisionRepository implementation
 */
export class DecisionRepository implements IDecisionRepository {
  constructor(private manager: StatePersistenceManager) {}

  async getActiveDecision(): Promise<HumanDecisionRequest | null> {
    return this.manager.getState().activeHumanDecision || null;
  }

  async setActiveDecision(decision: HumanDecisionRequest | null): Promise<void> {
    this.manager.updateState(draft => {
      draft.activeHumanDecision = decision;
    });
  }

  async recordDecisionResolution(decisionId: string, optionId: string): Promise<void> {
    this.manager.updateState(draft => {
      draft.activeHumanDecision = null;
      draft.lastDecisionReason = `Resolved decision ${decisionId} with option ${optionId}`;
    });
  }
}

/**
 * AdaptationRepository implementation
 */
export class AdaptationRepository implements IAdaptationRepository {
  constructor(private manager: StatePersistenceManager) {}

  async getPatterns(): Promise<AdaptationPattern[]> {
    return this.manager.getState().adaptationPatterns || [];
  }

  async getProposals(): Promise<AdaptationProposal[]> {
    return this.manager.getState().adaptationProposals || [];
  }

  async saveProposal(proposal: AdaptationProposal): Promise<void> {
    this.manager.updateState(draft => {
      const idx = draft.adaptationProposals.findIndex(p => p.id === proposal.id);
      if (idx >= 0) {
        draft.adaptationProposals[idx] = proposal;
      } else {
        draft.adaptationProposals = [proposal, ...draft.adaptationProposals];
      }
    });
  }

  async updateProposalStatus(id: string, status: AdaptationProposal['status']): Promise<void> {
    this.manager.updateState(draft => {
      draft.adaptationProposals = draft.adaptationProposals.map(p =>
        p.id === id
          ? {
              ...p,
              status,
              appliedAt: status === 'APPLIED' ? new Date().toISOString() : p.appliedAt,
            }
          : p
      );
    });
  }
}

/**
 * GovernanceRepository implementation
 */
export class GovernanceRepository implements IGovernanceRepository {
  constructor(private manager: StatePersistenceManager) {}

  async getAutonomyLevel(): Promise<AutonomyLevel> {
    return this.manager.getState().autonomyLevel ?? 3;
  }

  async setAutonomyLevel(level: AutonomyLevel): Promise<void> {
    this.manager.updateState(draft => {
      draft.autonomyLevel = level;
    });
  }

  async getUserOverrides(): Promise<UserOverrideRecord[]> {
    return this.manager.getState().userOverrides || [];
  }

  async recordUserOverride(override: UserOverrideRecord): Promise<void> {
    this.manager.updateState(draft => {
      draft.userOverrides = [override, ...(draft.userOverrides || [])].slice(0, 100);
    });
  }
}

/**
 * EventRepository implementation
 */
export class EventRepository implements IEventRepository {
  constructor(private manager: StatePersistenceManager) {}

  async getEvents(limit: number = 100): Promise<SystemEvent[]> {
    const events = this.manager.getState().events || [];
    return events.slice(0, limit);
  }

  async appendEvent(event: SystemEvent): Promise<void> {
    this.manager.updateState(draft => {
      draft.events = [event, ...(draft.events || [])].slice(0, 150);
    });
  }

  async appendEvents(events: SystemEvent[]): Promise<void> {
    this.manager.updateState(draft => {
      draft.events = [...events, ...(draft.events || [])].slice(0, 150);
    });
  }
}

/**
 * ExecutionRepository implementation (Maintains 100% backward-compatibility with Sprint 1 IExecutionRepository)
 */
export class ExecutionRepository implements IExecutionRepository {
  constructor(private manager: StatePersistenceManager) {}

  async load(): Promise<AppState> {
    return this.manager.getState();
  }

  async save(state: AppState): Promise<void> {
    this.manager.saveState(state);
  }

  async loadState(): Promise<AppState> {
    return this.load();
  }

  async saveState(state: AppState): Promise<void> {
    return this.save(state);
  }

  async reset(): Promise<AppState> {
    return this.manager.reset();
  }
}

/**
 * Composite Execution Repository / Unit of Work
 */
export class CompositeExecutionRepository implements IUnitOfWork, IExecutionRepository {
  private manager: StatePersistenceManager;

  public routine: IRoutineRepository;
  public activity: IActivityRepository;
  public allocation: IAllocationRepository;
  public dependency: IDependencyRepository;
  public fallback: IFallbackRepository;
  public deviation: IDeviationRepository;
  public decision: IDecisionRepository;
  public adaptation: IAdaptationRepository;
  public governance: IGovernanceRepository;
  public event: IEventRepository;
  public execution: IExecutionRepository;

  constructor(adapter: IStorageAdapter = new BrowserLocalStorageAdapter(), initialState?: AppState) {
    this.manager = new StatePersistenceManager(adapter, initialState);

    this.routine = new RoutineRepository(this.manager);
    this.activity = new ActivityRepository(this.manager);
    this.allocation = new AllocationRepository(this.manager);
    this.dependency = new DependencyRepository(this.manager);
    this.fallback = new FallbackRepository(this.manager);
    this.deviation = new DeviationRepository(this.manager);
    this.decision = new DecisionRepository(this.manager);
    this.adaptation = new AdaptationRepository(this.manager);
    this.governance = new GovernanceRepository(this.manager);
    this.event = new EventRepository(this.manager);
    this.execution = new ExecutionRepository(this.manager);
  }

  async load(): Promise<AppState> {
    return this.execution.load();
  }

  async save(state: AppState): Promise<void> {
    return this.execution.save(state);
  }

  async loadState(): Promise<AppState> {
    return this.execution.loadState();
  }

  async saveState(state: AppState): Promise<void> {
    return this.execution.saveState(state);
  }

  async reset(): Promise<AppState> {
    return this.execution.reset();
  }

  async getFullState(): Promise<AppState> {
    return this.manager.getState();
  }

  async saveFullState(state: AppState): Promise<void> {
    this.manager.saveState(state);
  }
}

/**
 * LocalExecutionRepository / LocalStorageExecutionRepository:
 * Backward-compatible operational repository adapter backed by LocalStorage
 */
export class LocalExecutionRepository extends CompositeExecutionRepository {
  constructor() {
    super(new BrowserLocalStorageAdapter());
  }
}

export const LocalStorageExecutionRepository = LocalExecutionRepository;

/**
 * InMemoryExecutionRepository:
 * Operational repository adapter for isolated in-memory testing and simulation
 */
export class InMemoryExecutionRepository extends CompositeExecutionRepository {
  constructor(initialState: AppState = DEFAULT_APP_STATE) {
    super(new InMemoryStorageAdapter(), initialState);
  }
}
