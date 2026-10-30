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

export interface IRoutineRepository {
  getRoutineState(): Promise<RoutineState>;
  getSystemMode(): Promise<SystemMode>;
  getDayType(): Promise<DayType>;
  updateRoutineState(state: RoutineState, reason?: string): Promise<void>;
  setSystemMode(mode: SystemMode): Promise<void>;
  setDayType(dayType: DayType): Promise<void>;
}

export interface IActivityRepository {
  getDefinitions(): Promise<ActivityDefinition[]>;
  getDefinitionById(id: string): Promise<ActivityDefinition | null>;
  getTasks(): Promise<RoutineTask[]>;
  getTaskById(id: string): Promise<RoutineTask | null>;
  updateTask(task: RoutineTask): Promise<void>;
  updateTasks(tasks: RoutineTask[]): Promise<void>;
  getInstances(): Promise<ActivityInstance[]>;
  getInstanceById(id: string): Promise<ActivityInstance | null>;
  saveInstance(instance: ActivityInstance): Promise<void>;
}

export interface IAllocationRepository {
  getAllocations(): Promise<DynamicAllocation[]>;
  getAllocationForActivity(activityId: string): Promise<DynamicAllocation | null>;
  saveAllocations(allocations: DynamicAllocation[]): Promise<void>;
}

export interface IDependencyRepository {
  getDependencies(): Promise<ActivityDependency[]>;
  getDependenciesForActivity(activityId: string): Promise<ActivityDependency[]>;
  saveDependency(dep: ActivityDependency): Promise<void>;
}

export interface IFallbackRepository {
  getPolicies(): Promise<FallbackPolicy[]>;
  getPolicyForActivity(activityId: string): Promise<FallbackPolicy | null>;
  updatePolicyTier(activityId: string, tierLevel: number): Promise<void>;
}

export interface IDeviationRepository {
  getDeviations(): Promise<DeviationRecord[]>;
  getDeviationById(id: string): Promise<DeviationRecord | null>;
  recordDeviation(deviation: DeviationRecord): Promise<void>;
  getInterventions(): Promise<InterventionRecord[]>;
  recordIntervention(intervention: InterventionRecord): Promise<void>;
  resolveDeviation(id: string, autonomously: boolean): Promise<void>;
}

export interface IDecisionRepository {
  getActiveDecision(): Promise<HumanDecisionRequest | null>;
  setActiveDecision(decision: HumanDecisionRequest | null): Promise<void>;
  recordDecisionResolution(decisionId: string, optionId: string): Promise<void>;
}

export interface IAdaptationRepository {
  getPatterns(): Promise<AdaptationPattern[]>;
  getProposals(): Promise<AdaptationProposal[]>;
  saveProposal(proposal: AdaptationProposal): Promise<void>;
  updateProposalStatus(id: string, status: AdaptationProposal['status']): Promise<void>;
}

export interface IGovernanceRepository {
  getAutonomyLevel(): Promise<AutonomyLevel>;
  setAutonomyLevel(level: AutonomyLevel): Promise<void>;
  getUserOverrides(): Promise<UserOverrideRecord[]>;
  recordUserOverride(override: UserOverrideRecord): Promise<void>;
}

export interface IEventRepository {
  getEvents(limit?: number): Promise<SystemEvent[]>;
  appendEvent(event: SystemEvent): Promise<void>;
  appendEvents(events: SystemEvent[]): Promise<void>;
}

export interface IExecutionRepository {
  load(): Promise<AppState>;
  save(state: AppState): Promise<void>;
  loadState(): Promise<AppState>;
  saveState(state: AppState): Promise<void>;
  reset(): Promise<AppState>;
}

export interface IUnitOfWork {
  routine: IRoutineRepository;
  activity: IActivityRepository;
  allocation: IAllocationRepository;
  dependency: IDependencyRepository;
  fallback: IFallbackRepository;
  deviation: IDeviationRepository;
  decision: IDecisionRepository;
  adaptation: IAdaptationRepository;
  governance: IGovernanceRepository;
  event: IEventRepository;
  execution: IExecutionRepository;
  getFullState(): Promise<AppState>;
  saveFullState(state: AppState): Promise<void>;
}

export interface IStorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
