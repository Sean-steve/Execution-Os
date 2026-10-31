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
  IUnitOfWork
} from '../repositories/interfaces';
import { CanonicalDatabase, LocalStorageCanonicalEngine, InMemoryCanonicalStorageEngine } from './canonicalDatabase';
import { FileCanonicalStorageEngine } from './fileCanonicalStorageEngine';
import { EntityMapper, DEFAULT_USER_ID, DEFAULT_TIMEZONE } from './entityMapper';
import { RUNTIME_INITIAL_STATE } from '../data/runtimeInitialState';
import {
  ActivityInstanceEntity,
  AllocationEntity,
  DeviationEntity,
  InterventionEntity,
  DecisionEntity,
  DecisionCandidateEntity,
  AdaptationProposalEntity,
  UserExecutionProfile
} from './entities';

/**
 * Production Routine Repository
 */
export class ProductionRoutineRepository implements IRoutineRepository {
  constructor(private db: CanonicalDatabase, private userId: string = DEFAULT_USER_ID) {}

  async getRoutineState(): Promise<RoutineState> {
    const profile = await this.db.findById<UserExecutionProfile>('profiles', `profile_${this.userId}`);
    return profile?.currentMode === 'RED' ? 'DISRUPTED' : 'STANDARD';
  }

  async getSystemMode(): Promise<SystemMode> {
    const profile = await this.db.findById<UserExecutionProfile>('profiles', `profile_${this.userId}`);
    return profile?.currentMode || 'GREEN';
  }

  async getDayType(): Promise<DayType> {
    const profile = await this.db.findById<UserExecutionProfile>('profiles', `profile_${this.userId}`);
    return profile?.dayType || 'STANDARD';
  }

  async updateRoutineState(state: RoutineState, reason?: string): Promise<void> {
    await this.db.update<UserExecutionProfile>(
      'profiles',
      `profile_${this.userId}`,
      profile => {
        // Record routine state change metadata
        if (reason) {
          (profile as any).routineChangeReason = reason;
        }
      }
    );
  }

  async setSystemMode(mode: SystemMode): Promise<void> {
    await this.db.update<UserExecutionProfile>(
      'profiles',
      `profile_${this.userId}`,
      profile => {
        profile.currentMode = mode;
      }
    );
  }

  async setDayType(dayType: DayType): Promise<void> {
    await this.db.update<UserExecutionProfile>(
      'profiles',
      `profile_${this.userId}`,
      profile => {
        profile.dayType = dayType;
      }
    );
  }
}

/**
 * Production Activity Repository
 */
export class ProductionActivityRepository implements IActivityRepository {
  constructor(private db: CanonicalDatabase, private userId: string = DEFAULT_USER_ID) {}

  async getDefinitions(): Promise<ActivityDefinition[]> {
    const defs = await this.db.findMany<any>('activity_definitions', a => a.userId === this.userId);
    return defs.map(d => ({
      id: d.id,
      anchorId: d.anchorId,
      title: d.title,
      objective: d.objective,
      mission: d.mission,
      priority: d.priority,
      estimatedDuration: d.estimatedDuration,
      minimumDuration: d.minimumDuration,
      preferredDuration: d.preferredDuration,
      energyRequirement: d.energyRequirement,
      focusRequirement: d.focusRequirement,
      locationRequirement: d.locationRequirement,
      prerequisites: d.prerequisites,
      completionCriteria: d.completionCriteria,
      verificationMethod: d.verificationMethod,
      fallbackPolicyId: d.fallbackPolicyId,
      autonomyLevel: d.autonomyLevel,
      modesAllowed: d.modesAllowed,
      isProtectedCommitment: d.isProtectedCommitment,
      interactiveActionType: d.interactiveActionType,
      associatedPillar: d.associatedPillar,
    }));
  }

  async getDefinitionById(id: string): Promise<ActivityDefinition | null> {
    const d = await this.db.findById<any>('activity_definitions', id);
    if (!d || d.userId !== this.userId) return null;
    return {
      id: d.id,
      anchorId: d.anchorId,
      title: d.title,
      objective: d.objective,
      mission: d.mission,
      priority: d.priority,
      estimatedDuration: d.estimatedDuration,
      minimumDuration: d.minimumDuration,
      preferredDuration: d.preferredDuration,
      energyRequirement: d.energyRequirement,
      focusRequirement: d.focusRequirement,
      locationRequirement: d.locationRequirement,
      prerequisites: d.prerequisites,
      completionCriteria: d.completionCriteria,
      verificationMethod: d.verificationMethod,
      fallbackPolicyId: d.fallbackPolicyId,
      autonomyLevel: d.autonomyLevel,
      modesAllowed: d.modesAllowed,
      isProtectedCommitment: d.isProtectedCommitment,
      interactiveActionType: d.interactiveActionType,
      associatedPillar: d.associatedPillar,
    };
  }

  async getTasks(): Promise<RoutineTask[]> {
    const instances = await this.db.findMany<ActivityInstanceEntity>('activity_instances', i => i.userId === this.userId);
    const defs = await this.getDefinitions();

    return instances.map(inst => {
      const def = defs.find(d => d.id === inst.activityDefinitionId);
      return {
        id: inst.activityDefinitionId,
        anchorId: def?.anchorId || 'ANCHOR_1_AWAKEN',
        title: def?.title || inst.activityDefinitionId,
        subtext: def?.objective,
        notes: inst.notes,
        timeWindow: `${Math.floor(inst.scheduledStartMinutes / 60)}:${(inst.scheduledStartMinutes % 60).toString().padStart(2, '0')} - ${Math.floor(inst.scheduledEndMinutes / 60)}:${(inst.scheduledEndMinutes % 60).toString().padStart(2, '0')}`,
        startMinutes: inst.scheduledStartMinutes,
        endMinutes: inst.scheduledEndMinutes,
        isNonNegotiable: (def?.priority || 1) >= 4,
        completed: inst.completed,
        modesAllowed: def?.modesAllowed || ['GREEN', 'YELLOW', 'RED'],
        interactiveActionType: def?.interactiveActionType,
        associatedPillar: def?.associatedPillar,
        completedAtMinutes: inst.actualStartMinutes,
        completedAtDate: inst.completedAtUtc,
        executionStatus: inst.executionStatus as any,
        missedWindow: inst.missedWindow,
        penaltyCutPoints: inst.penaltyCutPoints,
        fallbackLevel: inst.currentFallbackTier,
        allocatedStartMinutes: inst.allocatedStartMinutes,
        allocatedEndMinutes: inst.allocatedEndMinutes,
        isProtected: def?.isProtectedCommitment,
      };
    });
  }

  async getTaskById(id: string): Promise<RoutineTask | null> {
    const tasks = await this.getTasks();
    return tasks.find(t => t.id === id) || null;
  }

  async updateTask(task: RoutineTask): Promise<void> {
    const todayStr = new Date().toISOString().split('T')[0];
    const instId = `inst_${task.id}_${todayStr}`;
    const existing = await this.db.findById<ActivityInstanceEntity>('activity_instances', instId);

    const nowUtc = new Date().toISOString();
    const inst: ActivityInstanceEntity = {
      id: instId,
      activityDefinitionId: task.id,
      userId: this.userId,
      date: todayStr,
      scheduledStartMinutes: task.startMinutes,
      scheduledEndMinutes: task.endMinutes,
      allocatedStartMinutes: task.allocatedStartMinutes ?? task.startMinutes,
      allocatedEndMinutes: task.allocatedEndMinutes ?? task.endMinutes,
      actualStartMinutes: task.completedAtMinutes,
      actualEndMinutes: task.completedAtMinutes,
      currentFallbackTier: task.fallbackLevel ?? 0,
      completed: task.completed,
      completedAtUtc: task.completed ? (task.completedAtDate || nowUtc) : undefined,
      executionStatus: task.executionStatus || (task.completed ? 'ON_TIME' : 'PENDING'),
      completionPercentage: task.completed ? 100 : 0,
      interruptedCount: 0,
      missedWindow: task.missedWindow,
      penaltyCutPoints: task.penaltyCutPoints,
      notes: task.notes,
      version: existing ? existing.version + 1 : 1,
      createdAtUtc: existing ? existing.createdAtUtc : nowUtc,
      updatedAtUtc: nowUtc,
    };

    await this.db.upsert('activity_instances', inst);
  }

  async updateTasks(tasks: RoutineTask[]): Promise<void> {
    for (const task of tasks) {
      await this.updateTask(task);
    }
  }

  async getInstances(): Promise<ActivityInstance[]> {
    const entities = await this.db.findMany<ActivityInstanceEntity>('activity_instances', i => i.userId === this.userId);
    return entities.map(e => ({
      id: e.id,
      activityDefinitionId: e.activityDefinitionId,
      date: e.date,
      scheduledStartMinutes: e.scheduledStartMinutes,
      scheduledEndMinutes: e.scheduledEndMinutes,
      actualStartMinutes: e.actualStartMinutes,
      actualEndMinutes: e.actualEndMinutes,
      allocatedStartMinutes: e.allocatedStartMinutes,
      allocatedEndMinutes: e.allocatedEndMinutes,
      currentFallbackTier: e.currentFallbackTier,
      completed: e.completed,
      executionStatus: e.executionStatus,
      completionPercentage: e.completionPercentage,
      interruptedCount: e.interruptedCount,
      notes: e.notes,
      reasonForDeviation: e.reasonForDeviation,
      evidenceOutcome: e.evidenceOutcome,
    }));
  }

  async getInstanceById(id: string): Promise<ActivityInstance | null> {
    const e = await this.db.findById<ActivityInstanceEntity>('activity_instances', id);
    if (!e || e.userId !== this.userId) return null;
    return {
      id: e.id,
      activityDefinitionId: e.activityDefinitionId,
      date: e.date,
      scheduledStartMinutes: e.scheduledStartMinutes,
      scheduledEndMinutes: e.scheduledEndMinutes,
      actualStartMinutes: e.actualStartMinutes,
      actualEndMinutes: e.actualEndMinutes,
      allocatedStartMinutes: e.allocatedStartMinutes,
      allocatedEndMinutes: e.allocatedEndMinutes,
      currentFallbackTier: e.currentFallbackTier,
      completed: e.completed,
      executionStatus: e.executionStatus,
      completionPercentage: e.completionPercentage,
      interruptedCount: e.interruptedCount,
      notes: e.notes,
      reasonForDeviation: e.reasonForDeviation,
      evidenceOutcome: e.evidenceOutcome,
    };
  }

  async saveInstance(instance: ActivityInstance): Promise<void> {
    const nowUtc = new Date().toISOString();
    const existing = await this.db.findById<ActivityInstanceEntity>('activity_instances', instance.id);
    const entity: ActivityInstanceEntity = {
      id: instance.id,
      activityDefinitionId: instance.activityDefinitionId,
      userId: this.userId,
      date: instance.date,
      scheduledStartMinutes: instance.scheduledStartMinutes,
      scheduledEndMinutes: instance.scheduledEndMinutes,
      allocatedStartMinutes: instance.allocatedStartMinutes,
      allocatedEndMinutes: instance.allocatedEndMinutes,
      actualStartMinutes: instance.actualStartMinutes,
      actualEndMinutes: instance.actualEndMinutes,
      currentFallbackTier: instance.currentFallbackTier,
      completed: instance.completed,
      completedAtUtc: instance.completed ? nowUtc : undefined,
      executionStatus: instance.executionStatus,
      completionPercentage: instance.completionPercentage,
      interruptedCount: instance.interruptedCount,
      notes: instance.notes,
      reasonForDeviation: instance.reasonForDeviation,
      evidenceOutcome: instance.evidenceOutcome,
      version: existing ? existing.version + 1 : 1,
      createdAtUtc: existing ? existing.createdAtUtc : nowUtc,
      updatedAtUtc: nowUtc,
    };

    await this.db.upsert('activity_instances', entity);
  }
}

/**
 * Production Allocation Repository
 */
export class ProductionAllocationRepository implements IAllocationRepository {
  constructor(private db: CanonicalDatabase, private userId: string = DEFAULT_USER_ID) {}

  async getAllocations(): Promise<DynamicAllocation[]> {
    const allocs = await this.db.findMany<AllocationEntity>('allocations', a => a.userId === this.userId);
    return allocs.map(a => ({
      activityId: a.activityDefinitionId,
      instanceId: a.activityInstanceId,
      title: a.title,
      originalStartMinutes: a.originalStartMinutes,
      originalEndMinutes: a.originalEndMinutes,
      allocatedStartMinutes: a.allocatedStartMinutes,
      allocatedEndMinutes: a.allocatedEndMinutes,
      durationMinutes: a.durationMinutes,
      isCompressed: a.isCompressed,
      isFallback: a.isFallback,
      fallbackLevel: a.fallbackLevel,
      isProtected: a.isProtected,
      priority: a.priority,
      reasonForAdjustment: a.reasonForAdjustment,
      dependencyStatus: a.dependencyStatus,
    }));
  }

  async getAllocationForActivity(activityId: string): Promise<DynamicAllocation | null> {
    const allocs = await this.getAllocations();
    return allocs.find(a => a.activityId === activityId) || null;
  }

  async saveAllocations(allocations: DynamicAllocation[]): Promise<void> {
    const todayStr = new Date().toISOString().split('T')[0];
    const nowUtc = new Date().toISOString();

    await this.db.clearTable('allocations');
    for (const a of allocations) {
      const entity: AllocationEntity = {
        id: `alloc_${a.activityId}_${todayStr}`,
        userId: this.userId,
        date: todayStr,
        activityDefinitionId: a.activityId,
        activityInstanceId: a.instanceId,
        title: a.title,
        originalStartMinutes: a.originalStartMinutes,
        originalEndMinutes: a.originalEndMinutes,
        allocatedStartMinutes: a.allocatedStartMinutes,
        allocatedEndMinutes: a.allocatedEndMinutes,
        durationMinutes: a.durationMinutes,
        isCompressed: a.isCompressed,
        isFallback: a.isFallback,
        fallbackLevel: a.fallbackLevel,
        isProtected: a.isProtected,
        priority: a.priority,
        reasonForAdjustment: a.reasonForAdjustment,
        dependencyStatus: a.dependencyStatus,
        version: 1,
        calculatedAtUtc: nowUtc,
      };
      await this.db.insert('allocations', entity);
    }
  }
}

/**
 * Production Dependency Repository
 */
export class ProductionDependencyRepository implements IDependencyRepository {
  constructor(private db: CanonicalDatabase, private userId: string = DEFAULT_USER_ID) {}

  async getDependencies(): Promise<ActivityDependency[]> {
    const deps = await this.db.findMany<any>('dependencies', d => d.userId === this.userId);
    return deps.map(d => ({
      id: d.id,
      sourceActivityId: d.sourceActivityId,
      targetActivityId: d.targetActivityId,
      type: d.type,
      description: d.description,
      isMandatory: d.isMandatory,
    }));
  }

  async getDependenciesForActivity(activityId: string): Promise<ActivityDependency[]> {
    const deps = await this.getDependencies();
    return deps.filter(d => d.sourceActivityId === activityId || d.targetActivityId === activityId);
  }

  async saveDependency(dep: ActivityDependency): Promise<void> {
    const nowUtc = new Date().toISOString();
    const existing = await this.db.findById<any>('dependencies', dep.id);
    const entity = {
      id: dep.id,
      userId: this.userId,
      sourceActivityId: dep.sourceActivityId,
      targetActivityId: dep.targetActivityId,
      type: dep.type,
      description: dep.description,
      isMandatory: dep.isMandatory,
      version: existing ? existing.version + 1 : 1,
      createdAtUtc: existing ? existing.createdAtUtc : nowUtc,
      updatedAtUtc: nowUtc,
    };
    await this.db.upsert('dependencies', entity);
  }
}

/**
 * Production Fallback Repository
 */
export class ProductionFallbackRepository implements IFallbackRepository {
  constructor(private db: CanonicalDatabase, private userId: string = DEFAULT_USER_ID) {}

  async getPolicies(): Promise<FallbackPolicy[]> {
    const policies = await this.db.findMany<any>('fallback_policies', p => p.userId === this.userId);
    const options = await this.db.findMany<any>('fallback_options', o => o.userId === this.userId);

    return policies.map(p => {
      const tiers = options
        .filter(o => o.policyId === p.id)
        .map(o => ({
          level: o.level,
          title: o.title,
          description: o.description,
          durationMinutes: o.durationMinutes,
          expectedOutcome: o.expectedOutcome,
          preservesIntentScore: o.preservesIntentScore,
        }));

      return {
        id: p.id,
        activityId: p.activityId,
        activeTierLevel: p.activeTierLevel,
        triggerCondition: p.triggerCondition,
        tiers,
      };
    });
  }

  async getPolicyForActivity(activityId: string): Promise<FallbackPolicy | null> {
    const policies = await this.getPolicies();
    return policies.find(p => p.activityId === activityId) || null;
  }

  async updatePolicyTier(activityId: string, tierLevel: number): Promise<void> {
    const policies = await this.getPolicies();
    const target = policies.find(p => p.activityId === activityId);
    if (target) {
      await this.db.update<any>('fallback_policies', target.id, p => {
        p.activeTierLevel = tierLevel;
      });
    }
  }
}

/**
 * Production Deviation Repository
 */
export class ProductionDeviationRepository implements IDeviationRepository {
  constructor(private db: CanonicalDatabase, private userId: string = DEFAULT_USER_ID) {}

  async getDeviations(): Promise<DeviationRecord[]> {
    const devs = await this.db.findMany<DeviationEntity>('deviations', d => d.userId === this.userId);
    return devs.map(d => ({
      id: d.id,
      timestamp: d.detectedAtUtc,
      activityId: d.activityId,
      type: d.type,
      severity: d.severity,
      minutesDelayed: d.minutesDelayed,
      likelyCause: d.likelyCause,
      impactSummary: d.impactSummary,
      isResolved: d.isResolved,
      resolvedAutonomously: d.resolvedAutonomously,
      interventionId: d.interventionId,
    }));
  }

  async getDeviationById(id: string): Promise<DeviationRecord | null> {
    const d = await this.db.findById<DeviationEntity>('deviations', id);
    if (!d || d.userId !== this.userId) return null;
    return {
      id: d.id,
      timestamp: d.detectedAtUtc,
      activityId: d.activityId,
      type: d.type,
      severity: d.severity,
      minutesDelayed: d.minutesDelayed,
      likelyCause: d.likelyCause,
      impactSummary: d.impactSummary,
      isResolved: d.isResolved,
      resolvedAutonomously: d.resolvedAutonomously,
      interventionId: d.interventionId,
    };
  }

  async recordDeviation(deviation: DeviationRecord): Promise<void> {
    const nowUtc = new Date().toISOString();
    const entity: DeviationEntity = {
      id: deviation.id,
      userId: this.userId,
      activityId: deviation.activityId,
      type: deviation.type,
      severity: deviation.severity,
      minutesDelayed: deviation.minutesDelayed,
      likelyCause: deviation.likelyCause,
      impactSummary: deviation.impactSummary,
      isResolved: deviation.isResolved,
      resolvedAutonomously: deviation.resolvedAutonomously,
      interventionId: deviation.interventionId,
      detectedAtUtc: deviation.timestamp || nowUtc,
      version: 1,
      createdAtUtc: deviation.timestamp || nowUtc,
      updatedAtUtc: nowUtc,
    };
    await this.db.upsert('deviations', entity);
  }

  async getInterventions(): Promise<InterventionRecord[]> {
    const invs = await this.db.findMany<InterventionEntity>('interventions', i => i.userId === this.userId);
    return invs.map(i => ({
      id: i.id,
      timestamp: i.executedAtUtc,
      deviationId: i.deviationId,
      actionTaken: i.actionTaken,
      description: i.description,
      resultStatus: i.resultStatus,
      humanApprovalRequired: i.humanApprovalRequired,
      humanApproved: i.humanApproved,
    }));
  }

  async recordIntervention(intervention: InterventionRecord): Promise<void> {
    const nowUtc = new Date().toISOString();
    const entity: InterventionEntity = {
      id: intervention.id,
      userId: this.userId,
      deviationId: intervention.deviationId,
      actionTaken: intervention.actionTaken,
      description: intervention.description,
      resultStatus: intervention.resultStatus,
      humanApprovalRequired: intervention.humanApprovalRequired,
      humanApproved: intervention.humanApproved,
      executedAtUtc: intervention.timestamp || nowUtc,
      version: 1,
      createdAtUtc: intervention.timestamp || nowUtc,
      updatedAtUtc: nowUtc,
    };
    await this.db.upsert('interventions', entity);
  }

  async resolveDeviation(id: string, autonomously: boolean): Promise<void> {
    const nowUtc = new Date().toISOString();
    await this.db.update<DeviationEntity>('deviations', id, d => {
      d.isResolved = true;
      d.resolvedAutonomously = autonomously;
      d.resolvedAtUtc = nowUtc;
    });

    if (autonomously) {
      await this.db.update<UserExecutionProfile>('profiles', `profile_${this.userId}`, p => {
        p.autonomousResolutionCount = (p.autonomousResolutionCount || 0) + 1;
      });
    }
  }
}

/**
 * Production Decision Repository
 */
export class ProductionDecisionRepository implements IDecisionRepository {
  constructor(private db: CanonicalDatabase, private userId: string = DEFAULT_USER_ID) {}

  async getActiveDecision(): Promise<HumanDecisionRequest | null> {
    const pending = await this.db.findMany<DecisionEntity>('decisions', d => d.userId === this.userId && d.resolutionStatus === 'PENDING');
    if (pending.length === 0) return null;

    const dec = pending[0];
    const candidates = await this.db.findMany<DecisionCandidateEntity>('decision_candidates', c => c.contextId === dec.contextId);

    return {
      id: dec.id,
      title: dec.title,
      description: dec.description,
      reason: dec.reason,
      urgency: dec.urgency,
      options: candidates.map(c => ({
        id: c.optionKey,
        label: c.label,
        description: c.description,
        consequence: c.consequence,
      })),
      createdAt: dec.createdAtUtc,
    };
  }

  async setActiveDecision(decision: HumanDecisionRequest | null): Promise<void> {
    if (!decision) {
      const pending = await this.db.findMany<DecisionEntity>('decisions', d => d.userId === this.userId && d.resolutionStatus === 'PENDING');
      for (const p of pending) {
        await this.db.update<DecisionEntity>('decisions', p.id, d => {
          d.resolutionStatus = 'DISMISSED';
        });
      }
      return;
    }

    const nowUtc = new Date().toISOString();
    const ctxId = `ctx_${decision.id}`;

    await this.db.upsert('decision_contexts', {
      id: ctxId,
      userId: this.userId,
      systemMode: 'GREEN',
      routineState: 'STANDARD',
      availableMinutes: 30,
      createdAtUtc: decision.createdAt || nowUtc,
    });

    for (const opt of decision.options) {
      await this.db.upsert('decision_candidates', {
        id: `opt_${decision.id}_${opt.id}`,
        contextId: ctxId,
        optionKey: opt.id,
        label: opt.label,
        description: opt.description,
        consequence: opt.consequence,
      });
    }

    await this.db.upsert('decisions', {
      id: decision.id,
      userId: this.userId,
      contextId: ctxId,
      title: decision.title,
      description: decision.description,
      reason: decision.reason,
      urgency: decision.urgency,
      resolutionStatus: 'PENDING',
      version: 1,
      createdAtUtc: decision.createdAt || nowUtc,
      updatedAtUtc: nowUtc,
    });
  }

  async recordDecisionResolution(decisionId: string, optionId: string): Promise<void> {
    const nowUtc = new Date().toISOString();
    const candidate = await this.db.findMany<DecisionCandidateEntity>('decision_candidates', c => c.optionKey === optionId);
    await this.db.update<DecisionEntity>('decisions', decisionId, d => {
      d.resolutionStatus = 'RESOLVED_BY_USER';
      d.selectedCandidateId = candidate[0]?.id || optionId;
      d.resolvedAtUtc = nowUtc;
    });
  }
}

/**
 * Production Adaptation Repository
 */
export class ProductionAdaptationRepository implements IAdaptationRepository {
  constructor(private db: CanonicalDatabase, private userId: string = DEFAULT_USER_ID) {}

  async getPatterns(): Promise<AdaptationPattern[]> {
    const pats = await this.db.findMany<any>('adaptation_patterns', p => p.userId === this.userId);
    return pats.map(p => ({
      id: p.id,
      activityId: p.activityId,
      patternType: p.patternType as any,
      evidenceCount: p.evidenceCount,
      failureRatePercent: p.failureRatePercent,
      hypothesis: p.hypothesis,
      detectedAt: p.detectedAtUtc,
    }));
  }

  async getProposals(): Promise<AdaptationProposal[]> {
    const props = await this.db.findMany<AdaptationProposalEntity>('adaptation_proposals', p => p.userId === this.userId);
    return props.map(p => ({
      id: p.id,
      patternId: p.patternId,
      activityId: p.activityId,
      title: p.title,
      description: p.description,
      suggestedChange: p.suggestedChange,
      impactLevel: p.impactLevel,
      status: p.status as any,
      proposedAt: p.proposedAtUtc,
      appliedAt: p.appliedAtUtc,
    }));
  }

  async saveProposal(proposal: AdaptationProposal): Promise<void> {
    const nowUtc = new Date().toISOString();
    const existing = await this.db.findById<AdaptationProposalEntity>('adaptation_proposals', proposal.id);
    const entity: AdaptationProposalEntity = {
      id: proposal.id,
      userId: this.userId,
      patternId: proposal.patternId,
      activityId: proposal.activityId,
      title: proposal.title,
      description: proposal.description,
      suggestedChange: proposal.suggestedChange,
      impactLevel: proposal.impactLevel,
      status: proposal.status,
      proposedAtUtc: proposal.proposedAt || nowUtc,
      appliedAtUtc: proposal.appliedAt,
      version: existing ? existing.version + 1 : 1,
      createdAtUtc: existing ? existing.createdAtUtc : nowUtc,
      updatedAtUtc: nowUtc,
    };
    await this.db.upsert('adaptation_proposals', entity);
  }

  async updateProposalStatus(id: string, status: AdaptationProposal['status']): Promise<void> {
    const nowUtc = new Date().toISOString();
    await this.db.update<AdaptationProposalEntity>('adaptation_proposals', id, p => {
      p.status = status;
      if (status === 'APPLIED') {
        p.appliedAtUtc = nowUtc;
      }
    });
  }
}

/**
 * Production Governance Repository
 */
export class ProductionGovernanceRepository implements IGovernanceRepository {
  constructor(private db: CanonicalDatabase, private userId: string = DEFAULT_USER_ID) {}

  async getAutonomyLevel(): Promise<AutonomyLevel> {
    const profile = await this.db.findById<UserExecutionProfile>('profiles', `profile_${this.userId}`);
    return profile?.autonomyLevel ?? 3;
  }

  async setAutonomyLevel(level: AutonomyLevel): Promise<void> {
    await this.db.update<UserExecutionProfile>('profiles', `profile_${this.userId}`, p => {
      p.autonomyLevel = level;
    });
    const govId = `gov_policy_${this.userId}`;
    const gov = await this.db.findById<any>('governance_policies', govId);
    if (gov) {
      await this.db.update<any>('governance_policies', govId, g => {
        g.autonomyLevel = level;
      });
    }
  }

  async getUserOverrides(): Promise<UserOverrideRecord[]> {
    const ovrs = await this.db.findMany<any>('overrides', o => o.userId === this.userId);
    return ovrs.map(o => ({
      id: o.id,
      timestamp: o.occurredAtUtc,
      activityId: o.activityId,
      overrideType: o.overrideType,
      reason: o.reason,
      previousState: o.previousState,
      newState: o.newState,
    }));
  }

  async recordUserOverride(override: UserOverrideRecord): Promise<void> {
    const nowUtc = new Date().toISOString();
    await this.db.upsert('overrides', {
      id: override.id,
      userId: this.userId,
      activityId: override.activityId,
      overrideType: override.overrideType,
      reason: override.reason,
      previousState: override.previousState,
      newState: override.newState,
      occurredAtUtc: override.timestamp || nowUtc,
    });
  }
}

/**
 * Production Event Repository
 */
export class ProductionEventRepository implements IEventRepository {
  constructor(private db: CanonicalDatabase, private userId: string = DEFAULT_USER_ID) {}

  async getEvents(limit: number = 100): Promise<SystemEvent[]> {
    const events = await this.db.findMany<any>('event_records', e => e.userId === this.userId);
    return events.slice(0, limit).map(e => ({
      event_id: e.event_id,
      event_type: e.event_type,
      event_version: e.event_version,
      occurred_at: e.occurred_at,
      actor: e.actor,
      subject: e.subject,
      scope: e.scope,
      correlation_id: e.correlation_id,
      causation_id: e.causation_id,
      payload: e.payload,
      metadata: e.metadata,
    }));
  }

  async appendEvent(event: SystemEvent): Promise<void> {
    const nowUtc = new Date().toISOString();
    await this.db.upsert('event_records', {
      id: event.event_id,
      event_id: event.event_id,
      userId: this.userId,
      event_type: event.event_type,
      event_version: event.event_version || '1.0',
      occurred_at: event.occurred_at || nowUtc,
      actor: event.actor,
      subject: event.subject,
      scope: event.scope,
      correlation_id: event.correlation_id,
      causation_id: event.causation_id,
      payload: event.payload,
      metadata: event.metadata,
    });
  }

  async appendEvents(events: SystemEvent[]): Promise<void> {
    for (const evt of events) {
      await this.appendEvent(evt);
    }
  }
}

/**
 * Production Execution Repository & Unit of Work (Backed by Canonical Database)
 */
export class ProductionExecutionRepository implements IUnitOfWork, IExecutionRepository {
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

  private mapper: EntityMapper;

  constructor(
    private db?: CanonicalDatabase,
    private userId: string = DEFAULT_USER_ID,
    private timezone: string = DEFAULT_TIMEZONE,
    initialState?: AppState
  ) {
    if (!this.db) {
      const isNode = typeof window === 'undefined' && typeof process !== 'undefined' && Boolean(process.versions?.node);
      const engine = isNode ? new FileCanonicalStorageEngine() : new LocalStorageCanonicalEngine();
      this.db = new CanonicalDatabase(engine);
    }
    this.mapper = new EntityMapper(this.userId, this.timezone);

    this.routine = new ProductionRoutineRepository(this.db, this.userId);
    this.activity = new ProductionActivityRepository(this.db, this.userId);
    this.allocation = new ProductionAllocationRepository(this.db, this.userId);
    this.dependency = new ProductionDependencyRepository(this.db, this.userId);
    this.fallback = new ProductionFallbackRepository(this.db, this.userId);
    this.deviation = new ProductionDeviationRepository(this.db, this.userId);
    this.decision = new ProductionDecisionRepository(this.db, this.userId);
    this.adaptation = new ProductionAdaptationRepository(this.db, this.userId);
    this.governance = new ProductionGovernanceRepository(this.db, this.userId);
    this.event = new ProductionEventRepository(this.db, this.userId);
    this.execution = this;

    if (initialState) {
      const canonical = this.mapper.appStateToCanonical(initialState);
      this.db.restoreSnapshot(canonical);
    }
  }

  async load(): Promise<AppState> {
    await this.db.initialize();
    const count = await this.db.count('profiles');
    if (count === 0) {
      const canonical = this.mapper.appStateToCanonical(RUNTIME_INITIAL_STATE);
      await this.db.restoreSnapshot(canonical);
      return JSON.parse(JSON.stringify(RUNTIME_INITIAL_STATE));
    }
    const snapshot = this.db.getSnapshot();
    return this.mapper.canonicalToAppState(snapshot, RUNTIME_INITIAL_STATE);
  }

  async save(state: AppState): Promise<void> {
    await this.db.initialize();
    const canonical = this.mapper.appStateToCanonical(state);
    await this.db.restoreSnapshot(canonical);
  }

  async loadState(): Promise<AppState> {
    return this.load();
  }

  async saveState(state: AppState): Promise<void> {
    return this.save(state);
  }

  async reset(): Promise<AppState> {
    await this.db.clearAll();
    const canonical = this.mapper.appStateToCanonical(RUNTIME_INITIAL_STATE);
    await this.db.restoreSnapshot(canonical);
    return JSON.parse(JSON.stringify(RUNTIME_INITIAL_STATE));
  }

  async getFullState(): Promise<AppState> {
    return this.load();
  }

  async saveFullState(state: AppState): Promise<void> {
    return this.save(state);
  }
}
