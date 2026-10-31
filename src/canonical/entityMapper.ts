import {
  AppState,
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
  Reward,
  DayHistoryRecord
} from '../types';
import {
  UserExecutionProfile,
  RoutineDefinition,
  RoutineVersion,
  RoutineStep,
  ActivityDefinitionEntity,
  ActivityInstanceEntity,
  AllocationEntity,
  DependencyEntity,
  FallbackPolicyEntity,
  FallbackOptionEntity,
  ExecutionSessionEntity,
  ExecutionEvidenceEntity,
  DeviationEntity,
  InterventionEntity,
  DecisionEntity,
  DecisionContextEntity,
  DecisionCandidateEntity,
  AdaptationPatternEntity,
  AdaptationProposalEntity,
  GovernancePolicyEntity,
  ProtectedCommitmentEntity,
  OverrideEntity,
  EventRecordEntity,
  RewardLedgerEntity,
  RewardDefinitionEntity,
  DayHistoryEntity,
  LegacyRawMetadataEntity,
  PerformanceSessionEntity,
  PerformanceProtocolEntity,
  DailyPerformanceRecordEntity,
  WeeklyPerformanceRecordEntity,
  DayOfWeekPerformanceProfileEntity,
  WeeklyInsightEntity,
  WeeklyAdaptationRecommendationEntity
} from './entities';
import { CanonicalDatabaseSchema, createEmptyCanonicalSchema } from './canonicalDatabase';
import { CANONICAL_PERFORMANCE_PROTOCOLS } from '../data/performanceProtocols';

export const DEFAULT_USER_ID = 'user_primary';
export const DEFAULT_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/**
 * EntityMapper: Maps between AppState (Domain) and Canonical Database Schema (Durable Persistence)
 */
export class EntityMapper {
  private userId: string;
  private timezone: string;

  constructor(userId: string = DEFAULT_USER_ID, timezone: string = DEFAULT_TIMEZONE) {
    this.userId = userId;
    this.timezone = timezone;
  }

  /**
   * Convert AppState to CanonicalDatabaseSchema
   */
  appStateToCanonical(state: AppState): CanonicalDatabaseSchema {
    const nowUtc = new Date().toISOString();
    const schema = createEmptyCanonicalSchema();

    // 1. User Profile
    const profile: UserExecutionProfile = {
      id: `profile_${this.userId}`,
      userId: this.userId,
      timezone: this.timezone,
      currentMode: state.currentMode,
      dayType: state.dayType,
      routineState: state.routineState,
      routineChangeReason: state.routineChangeReason,
      autonomyLevel: state.autonomyLevel,
      strictTimeEnforcement: state.strictTimeEnforcement ?? false,
      activeView: state.activeView || 'DASHBOARD',
      rewardPoints: state.rewardPoints || 0,
      autonomousResolutionCount: state.autonomousResolutionCount || 0,
      disciplinePenaltiesCount: state.disciplinePenaltiesCount || 0,
      victoryQuestionAnswer: state.victoryQuestionAnswer,
      identityStatus: state.identityStatus,
      tomorrowPlan: state.tomorrowPlan,
      dailyReview: state.dailyReview,
      companyOfTheDay: state.companyOfTheDay,
      tradingProtocol: state.tradingProtocol,
      version: 1,
      createdAtUtc: nowUtc,
      updatedAtUtc: nowUtc,
    };
    schema.profiles.push(profile);

    // 2. Governance Policy
    const govPolicy: GovernancePolicyEntity = {
      id: `gov_policy_${this.userId}`,
      userId: this.userId,
      autonomyLevel: state.autonomyLevel,
      maxAutonomousDeferMinutes: 30,
      allowAutoFallback: state.autonomyLevel >= 2,
      allowAutoRoutineCompression: state.autonomyLevel >= 3,
      requireApprovalForSacrifices: state.autonomyLevel >= 4,
      version: 1,
      createdAtUtc: nowUtc,
      updatedAtUtc: nowUtc,
    };
    schema.governance_policies.push(govPolicy);

    // 3. Routine Definition & Version & Steps (Definitions != instances)
    const routineDefId = `routine_def_${state.dayType.toLowerCase()}`;
    const routineVersionId = `routine_ver_${state.dayType.toLowerCase()}_v1`;

    const routineDef: RoutineDefinition = {
      id: routineDefId,
      userId: this.userId,
      name: `${state.dayType} Routine`,
      description: `Canonical routine definition for ${state.dayType} mode`,
      dayType: state.dayType,
      isDefault: true,
      currentVersionId: routineVersionId,
      version: 1,
      createdAtUtc: nowUtc,
      updatedAtUtc: nowUtc,
    };
    schema.routine_definitions.push(routineDef);

    const routineVer: RoutineVersion = {
      id: routineVersionId,
      routineDefinitionId: routineDefId,
      userId: this.userId,
      versionNumber: 1,
      effectiveFromUtc: nowUtc,
      changeReason: state.routineChangeReason,
      version: 1,
      createdAtUtc: nowUtc,
      updatedAtUtc: nowUtc,
    };
    schema.routine_versions.push(routineVer);

    // 4. Activity Definitions & Routine Steps
    (state.activities || []).forEach((act, idx) => {
      const correspondingTask = (state.tasks || []).find(task => task.id === act.id);
      const actDef: ActivityDefinitionEntity = {
        id: act.id,
        userId: this.userId,
        anchorId: act.anchorId,
        title: act.title,
        objective: act.objective,
        mission: act.mission,
        priority: act.priority,
        estimatedDuration: act.estimatedDuration,
        minimumDuration: act.minimumDuration,
        preferredDuration: act.preferredDuration,
        energyRequirement: act.energyRequirement,
        focusRequirement: act.focusRequirement,
        locationRequirement: act.locationRequirement,
        prerequisites: act.prerequisites || [],
        completionCriteria: act.completionCriteria,
        verificationMethod: act.verificationMethod,
        fallbackPolicyId: act.fallbackPolicyId,
        autonomyLevel: act.autonomyLevel,
        modesAllowed: act.modesAllowed,
        isProtectedCommitment: act.isProtectedCommitment || correspondingTask?.isProtected || false,
        interactiveActionType: act.interactiveActionType || correspondingTask?.interactiveActionType,
        associatedPillar: act.associatedPillar,
        version: 1,
        createdAtUtc: nowUtc,
        updatedAtUtc: nowUtc,
      };
      schema.activity_definitions.push(actDef);

      if (actDef.isProtectedCommitment) {
        schema.protected_commitments.push({
          id: `prot_${act.id}`,
          userId: this.userId,
          activityDefinitionId: act.id,
          label: act.title,
          reason: 'Family / non-negotiable anchor block protected from autonomous compression',
          neverCompress: true,
          neverSkip: true,
          version: 1,
          createdAtUtc: nowUtc,
          updatedAtUtc: nowUtc,
        });
      }

      // Routine Step
      schema.routine_steps.push({
        id: `step_${routineVersionId}_${act.id}`,
        routineVersionId: routineVersionId,
        activityDefinitionId: act.id,
        userId: this.userId,
        orderIndex: idx,
        anchorId: act.anchorId,
        nominalStartMinutes: 0,
        nominalEndMinutes: act.estimatedDuration,
        isNonNegotiable: act.priority >= 4,
        isProtected: !!actDef.isProtectedCommitment,
        modesAllowed: act.modesAllowed,
        version: 1,
        createdAtUtc: nowUtc,
        updatedAtUtc: nowUtc,
      });
    });

    // HOS / external plan tasks may arrive without a pre-existing ActivityDefinition.
    // Materialize a generic execution definition so protection and schedule identity
    // survive canonical persistence/restart without importing whole-person policy.
    (state.tasks || [])
      .filter(task => !schema.activity_definitions.some(def => def.id === task.id))
      .forEach((task, idx) => {
        const duration = Math.max(1, task.endMinutes - task.startMinutes);
        const derived: ActivityDefinitionEntity = {
          id: task.id,
          userId: this.userId,
          anchorId: task.anchorId,
          title: task.title,
          objective: task.subtext || task.title,
          mission: '',
          priority: task.isNonNegotiable || task.isProtected ? 5 : 3,
          estimatedDuration: duration,
          minimumDuration: Math.min(duration, Math.max(1, Math.floor(duration * 0.5))),
          preferredDuration: duration,
          energyRequirement: 'MEDIUM',
          focusRequirement: task.interactiveActionType === 'FOCUS_BLOCK' ? 'HIGH' : 'MEDIUM',
          locationRequirement: 'ANY',
          prerequisites: [],
          completionCriteria: 'Authoritative execution outcome recorded.',
          verificationMethod: 'MANUAL_CHECK',
          fallbackPolicyId: '',
          autonomyLevel: 2,
          modesAllowed: task.modesAllowed || ['GREEN', 'YELLOW', 'RED'],
          isProtectedCommitment: Boolean(task.isProtected),
          interactiveActionType: task.interactiveActionType,
          associatedPillar: task.associatedPillar,
          version: 1,
          createdAtUtc: nowUtc,
          updatedAtUtc: nowUtc,
        };
        schema.activity_definitions.push(derived);

        schema.routine_steps.push({
          id: `step_${routineVersionId}_${task.id}`,
          routineVersionId,
          activityDefinitionId: task.id,
          userId: this.userId,
          orderIndex: (state.activities || []).length + idx,
          anchorId: task.anchorId,
          nominalStartMinutes: task.startMinutes,
          nominalEndMinutes: task.endMinutes,
          isNonNegotiable: task.isNonNegotiable,
          isProtected: Boolean(task.isProtected),
          modesAllowed: task.modesAllowed || ['GREEN', 'YELLOW', 'RED'],
          version: 1,
          createdAtUtc: nowUtc,
          updatedAtUtc: nowUtc,
        });

        if (task.isProtected) {
          schema.protected_commitments.push({
            id: `prot_${task.id}`,
            userId: this.userId,
            activityDefinitionId: task.id,
            label: task.title,
            reason: 'Protected commitment supplied by the active schedule authority.',
            neverCompress: true,
            neverSkip: true,
            version: 1,
            createdAtUtc: nowUtc,
            updatedAtUtc: nowUtc,
          });
        }
      });

    // 5. Activity Instances (Instances != definitions)
    const todayStr = new Date().toISOString().split('T')[0];
    (state.tasks || []).forEach(task => {
      const instId = `inst_${task.id}_${todayStr}`;
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
        version: 1,
        createdAtUtc: nowUtc,
        updatedAtUtc: nowUtc,
      };
      schema.activity_instances.push(inst);

      // If completed, record ExecutionEvidence & Session (Allocations != execution history)
      if (task.completed) {
        schema.execution_evidences.push({
          id: `ev_${instId}`,
          userId: this.userId,
          activityInstanceId: instId,
          evidenceType: task.interactiveActionType ? 'CHECKLIST_CONFIRM' : 'MANUAL_DECLARATION',
          payload: {
            title: task.title,
            completedAtMinutes: task.completedAtMinutes,
            penaltyCutPoints: task.penaltyCutPoints,
          },
          verifiedAtUtc: task.completedAtDate || nowUtc,
          verifiedBy: 'USER',
        });
      }
    });

    // 6. Allocations (Allocations != execution history)
    (state.dynamicAllocations || []).forEach(alloc => {
      schema.allocations.push({
        id: `alloc_${alloc.activityId}_${todayStr}`,
        userId: this.userId,
        date: todayStr,
        activityDefinitionId: alloc.activityId,
        activityInstanceId: alloc.instanceId,
        title: alloc.title,
        originalStartMinutes: alloc.originalStartMinutes,
        originalEndMinutes: alloc.originalEndMinutes,
        allocatedStartMinutes: alloc.allocatedStartMinutes,
        allocatedEndMinutes: alloc.allocatedEndMinutes,
        durationMinutes: alloc.durationMinutes,
        isCompressed: alloc.isCompressed,
        isFallback: alloc.isFallback,
        fallbackLevel: alloc.fallbackLevel,
        isProtected: alloc.isProtected,
        priority: alloc.priority,
        reasonForAdjustment: alloc.reasonForAdjustment,
        dependencyStatus: alloc.dependencyStatus,
        version: 1,
        calculatedAtUtc: nowUtc,
      });
    });

    // 7. Dependencies
    (state.dependencies || []).forEach(dep => {
      schema.dependencies.push({
        id: dep.id,
        userId: this.userId,
        sourceActivityId: dep.sourceActivityId,
        targetActivityId: dep.targetActivityId,
        type: dep.type,
        description: dep.description,
        isMandatory: dep.isMandatory,
        version: 1,
        createdAtUtc: nowUtc,
        updatedAtUtc: nowUtc,
      });
    });

    // 8. Fallback Policies & Options
    (state.fallbackPolicies || []).forEach(pol => {
      schema.fallback_policies.push({
        id: pol.id,
        userId: this.userId,
        activityId: pol.activityId,
        activeTierLevel: pol.activeTierLevel,
        triggerCondition: pol.triggerCondition,
        version: 1,
        createdAtUtc: nowUtc,
        updatedAtUtc: nowUtc,
      });

      pol.tiers.forEach(tier => {
        schema.fallback_options.push({
          id: `fbo_${pol.id}_lvl_${tier.level}`,
          policyId: pol.id,
          userId: this.userId,
          level: tier.level,
          title: tier.title,
          description: tier.description,
          durationMinutes: tier.durationMinutes,
          expectedOutcome: tier.expectedOutcome,
          preservesIntentScore: tier.preservesIntentScore,
          version: 1,
          createdAtUtc: nowUtc,
          updatedAtUtc: nowUtc,
        });
      });
    });

    // 9. Deviations & Interventions
    (state.deviations || []).forEach(dev => {
      schema.deviations.push({
        id: dev.id,
        userId: this.userId,
        activityId: dev.activityId,
        type: dev.type,
        severity: dev.severity,
        minutesDelayed: dev.minutesDelayed,
        likelyCause: dev.likelyCause,
        impactSummary: dev.impactSummary,
        isResolved: dev.isResolved,
        resolvedAutonomously: dev.resolvedAutonomously,
        interventionId: dev.interventionId,
        detectedAtUtc: dev.timestamp || nowUtc,
        resolvedAtUtc: dev.isResolved ? nowUtc : undefined,
        version: 1,
        createdAtUtc: dev.timestamp || nowUtc,
        updatedAtUtc: nowUtc,
      });
    });

    (state.interventions || []).forEach(inv => {
      schema.interventions.push({
        id: inv.id,
        userId: this.userId,
        deviationId: inv.deviationId,
        actionTaken: inv.actionTaken,
        description: inv.description,
        resultStatus: inv.resultStatus,
        humanApprovalRequired: inv.humanApprovalRequired,
        humanApproved: inv.humanApproved,
        executedAtUtc: inv.timestamp || nowUtc,
        version: 1,
        createdAtUtc: inv.timestamp || nowUtc,
        updatedAtUtc: nowUtc,
      });
    });

    // 10. Human Decisions
    if (state.activeHumanDecision) {
      const dec = state.activeHumanDecision;
      const ctxId = `ctx_${dec.id}`;
      schema.decision_contexts.push({
        id: ctxId,
        userId: this.userId,
        systemMode: state.currentMode,
        routineState: state.routineState,
        availableMinutes: 30,
        createdAtUtc: dec.createdAt || nowUtc,
      });

      dec.options.forEach(opt => {
        schema.decision_candidates.push({
          id: `opt_${dec.id}_${opt.id}`,
          contextId: ctxId,
          optionKey: opt.id,
          label: opt.label,
          description: opt.description,
          consequence: opt.consequence,
        });
      });

      schema.decisions.push({
        id: dec.id,
        userId: this.userId,
        contextId: ctxId,
        title: dec.title,
        description: dec.description,
        reason: dec.reason,
        urgency: dec.urgency,
        resolutionStatus: 'PENDING',
        version: 1,
        createdAtUtc: dec.createdAt || nowUtc,
        updatedAtUtc: nowUtc,
      });
    }

    // 11. Adaptation Patterns & Proposals
    (state.adaptationPatterns || []).forEach(pat => {
      schema.adaptation_patterns.push({
        id: pat.id,
        userId: this.userId,
        activityId: pat.activityId,
        patternType: pat.patternType,
        evidenceCount: pat.evidenceCount,
        failureRatePercent: pat.failureRatePercent,
        hypothesis: pat.hypothesis,
        detectedAtUtc: pat.detectedAt || nowUtc,
        version: 1,
        createdAtUtc: pat.detectedAt || nowUtc,
        updatedAtUtc: nowUtc,
      });
    });

    (state.adaptationProposals || []).forEach(prop => {
      schema.adaptation_proposals.push({
        id: prop.id,
        userId: this.userId,
        patternId: prop.patternId,
        activityId: prop.activityId,
        title: prop.title,
        description: prop.description,
        suggestedChange: prop.suggestedChange,
        impactLevel: prop.impactLevel,
        status: prop.status,
        proposedAtUtc: prop.proposedAt || nowUtc,
        appliedAtUtc: prop.appliedAt,
        version: 1,
        createdAtUtc: prop.proposedAt || nowUtc,
        updatedAtUtc: nowUtc,
      });
    });

    // 12. User Overrides
    (state.userOverrides || []).forEach(ovr => {
      schema.overrides.push({
        id: ovr.id,
        userId: this.userId,
        activityId: ovr.activityId,
        overrideType: ovr.overrideType,
        reason: ovr.reason,
        previousState: ovr.previousState,
        newState: ovr.newState,
        occurredAtUtc: ovr.timestamp || nowUtc,
      });
    });

    // 13. System Events
    (state.events || []).forEach(evt => {
      schema.event_records.push({
        id: evt.event_id,
        event_id: evt.event_id,
        userId: this.userId,
        event_type: evt.event_type,
        event_version: evt.event_version || '1.0',
        occurred_at: evt.occurred_at || nowUtc,
        actor: evt.actor,
        subject: evt.subject,
        scope: evt.scope,
        correlation_id: evt.correlation_id,
        causation_id: evt.causation_id,
        payload: evt.payload,
        metadata: evt.metadata,
      });
    });

    // 14. Rewards & Reward Ledgers
    (state.rewards || []).forEach(rew => {
      schema.reward_definitions.push({
        id: rew.id,
        userId: this.userId,
        title: rew.title,
        description: rew.description,
        category: rew.category,
        pointsRequired: rew.pointsRequired,
        unlocked: rew.unlocked,
        redeemed: rew.redeemed,
        redeemedAtUtc: rew.redeemedAt,
        version: 1,
        createdAtUtc: nowUtc,
        updatedAtUtc: nowUtc,
      });
    });

    if (state.rewardPoints > 0) {
      schema.reward_ledgers.push({
        id: `rw_initial_${this.userId}`,
        userId: this.userId,
        transactionType: 'POINTS_EARNED',
        amount: state.rewardPoints,
        balanceAfter: state.rewardPoints,
        reason: 'Current balance snapshot',
        occurredAtUtc: nowUtc,
      });
    }

    // 15. Day Histories
    (state.history || []).forEach(hist => {
      schema.day_histories.push({
        id: `hist_${hist.date}`,
        userId: this.userId,
        date: hist.date,
        score: hist.score,
        mode: hist.mode,
        dayType: hist.dayType,
        pillars: hist.pillars,
        topVictory: hist.topVictory,
        reflectionSummary: hist.reflectionSummary,
        createdAtUtc: nowUtc,
      });
    });

    // 16. HEE-011 Human Performance Sessions & Protocol Versions
    (state.performanceSessions || []).forEach(session => {
      schema.performance_sessions.push({
        ...(session as any),
        userId: session.userId || this.userId,
        version: session.version || 1,
        createdAtUtc: session.createdAtUtc || nowUtc,
        updatedAtUtc: session.updatedAtUtc || nowUtc,
      } as PerformanceSessionEntity);
    });

    CANONICAL_PERFORMANCE_PROTOCOLS.forEach(protocol => {
      schema.performance_protocols.push({
        id: protocol.id,
        userId: this.userId,
        protocolVersion: protocol.version,
        name: protocol.name,
        description: protocol.description,
        applicableActivityType: protocol.applicableActivityType,
        applicableEnvironment: protocol.applicableEnvironment,
        steps: protocol.steps,
        preparationRituals: protocol.preparationRituals,
        evidencePolicy: protocol.evidencePolicy,
        completionPolicy: protocol.completionPolicy,
        targetDurationMinutes: protocol.targetDurationMinutes,
        minimumDurationMinutes: protocol.minimumDurationMinutes,
        version: 1,
        createdAtUtc: nowUtc,
        updatedAtUtc: nowUtc,
      } as PerformanceProtocolEntity);
    });

    // 17. EOS-WPI-001 Weekly Performance Intelligence
    (state.dailyPerformanceRecords || []).forEach(record => {
      schema.daily_performance_records.push({
        ...record,
        version: 1,
        updatedAtUtc: record.finalizedAtUtc || record.createdAtUtc || nowUtc,
      } as DailyPerformanceRecordEntity);
    });

    (state.weeklyPerformanceRecords || []).forEach(record => {
      schema.weekly_performance_records.push({
        ...record,
        version: 1,
        updatedAtUtc: record.finalizedAtUtc || record.createdAtUtc || nowUtc,
      } as WeeklyPerformanceRecordEntity);
    });

    (state.dayOfWeekPerformanceProfiles || []).forEach(profileRecord => {
      schema.day_of_week_performance_profiles.push({
        ...profileRecord,
        version: 1,
        createdAtUtc: profileRecord.windowStart ? `${profileRecord.windowStart}T00:00:00.000Z` : nowUtc,
      } as DayOfWeekPerformanceProfileEntity);
    });

    (state.weeklyInsights || []).forEach(insight => {
      schema.weekly_insights.push({
        ...insight,
        userId: this.userId,
        version: 1,
        createdAtUtc: nowUtc,
        updatedAtUtc: nowUtc,
      } as WeeklyInsightEntity);
    });

    (state.weeklyAdaptationRecommendations || []).forEach(recommendation => {
      schema.weekly_adaptation_recommendations.push({
        ...recommendation,
        userId: this.userId,
        version: 1,
        updatedAtUtc: recommendation.createdAtUtc || nowUtc,
      } as WeeklyAdaptationRecommendationEntity);
    });

    // 18. Legacy Raw Metadata (Preserve unknown state safely)
    const knownKeys = new Set([
      'currentMode', 'dayType', 'routineState', 'routineChangeReason', 'autonomyLevel',
      'isSimulatedTime', 'simulatedTime', 'tasks', 'activities', 'activityInstances',
      'dependencies', 'fallbackPolicies', 'dynamicAllocations', 'deviations',
      'interventions', 'adaptationPatterns', 'adaptationProposals', 'userOverrides',
      'events', 'activeHumanDecision', 'identityStatus', 'tradingProtocol',
      'companyOfTheDay', 'dailyReview', 'tomorrowPlan', 'dreamEntries', 'rewardPoints',
      'rewards', 'history', 'activeView', 'pointsAwardedTasks', 'activeTimers',
      'focusSession', 'victoryQuestionAnswer', 'morningWorkoutSetsDone',
      'afternoonWorkoutSetsDone', 'morningOutdoorMinutes', 'meditationMinutes',
      'selectedDayOverride', 'disciplinePenaltiesCount', 'strictTimeEnforcement',
      'earlyExecutionConfirmTask', 'performanceSessions', 'activePerformanceSessionId',
      'dailyPerformanceRecords', 'weeklyPerformanceRecords', 'dayOfWeekPerformanceProfiles',
      'weeklyInsights', 'weeklyAdaptationRecommendations'
    ]);

    Object.keys(state).forEach(key => {
      if (!knownKeys.has(key)) {
        schema.legacy_raw_metadata.push({
          id: `legacy_${key}`,
          userId: this.userId,
          key,
          rawPayload: (state as any)[key],
          migratedAtUtc: nowUtc,
        });
      }
    });

    return schema;
  }

  /**
   * Convert CanonicalDatabaseSchema back to AppState (Domain)
   */
  canonicalToAppState(schema: CanonicalDatabaseSchema, fallbackState?: AppState): AppState {
    const profile = schema.profiles.find(p => p.userId === this.userId) || schema.profiles[0];
    const fallback = fallbackState;

    const currentMode = profile?.currentMode || fallback?.currentMode || 'GREEN';
    const dayType = profile?.dayType || fallback?.dayType || 'STANDARD';
    const routineState = profile?.routineState || fallback?.routineState || 'STANDARD';
    const routineChangeReason = profile?.routineChangeReason || fallback?.routineChangeReason;
    const autonomyLevel = profile?.autonomyLevel ?? fallback?.autonomyLevel ?? 3;
    const strictTimeEnforcement = profile?.strictTimeEnforcement ?? fallback?.strictTimeEnforcement ?? false;
    const rewardPoints = profile?.rewardPoints ?? fallback?.rewardPoints ?? 0;
    const disciplinePenaltiesCount = profile?.disciplinePenaltiesCount ?? fallback?.disciplinePenaltiesCount ?? 0;
    const autonomousResolutionCount = profile?.autonomousResolutionCount ?? fallback?.autonomousResolutionCount ?? 0;

    // Activities
    const activities: ActivityDefinition[] = schema.activity_definitions.map(ad => ({
      id: ad.id,
      anchorId: ad.anchorId,
      title: ad.title,
      objective: ad.objective,
      mission: ad.mission,
      priority: ad.priority,
      estimatedDuration: ad.estimatedDuration,
      minimumDuration: ad.minimumDuration,
      preferredDuration: ad.preferredDuration,
      energyRequirement: ad.energyRequirement,
      focusRequirement: ad.focusRequirement,
      locationRequirement: ad.locationRequirement,
      prerequisites: ad.prerequisites,
      completionCriteria: ad.completionCriteria,
      verificationMethod: ad.verificationMethod,
      fallbackPolicyId: ad.fallbackPolicyId,
      autonomyLevel: ad.autonomyLevel,
      modesAllowed: ad.modesAllowed,
      isProtectedCommitment: ad.isProtectedCommitment,
      interactiveActionType: ad.interactiveActionType,
      associatedPillar: ad.associatedPillar,
    }));

    // Fallback Policies
    const fallbackPolicies: FallbackPolicy[] = schema.fallback_policies.map(fp => {
      const options = schema.fallback_options
        .filter(opt => opt.policyId === fp.id)
        .map(opt => ({
          level: opt.level,
          title: opt.title,
          description: opt.description,
          durationMinutes: opt.durationMinutes,
          expectedOutcome: opt.expectedOutcome,
          preservesIntentScore: opt.preservesIntentScore,
        }));

      return {
        id: fp.id,
        activityId: fp.activityId,
        activeTierLevel: fp.activeTierLevel,
        triggerCondition: fp.triggerCondition,
        tiers: options.length > 0 ? options : (fallback?.fallbackPolicies.find(f => f.id === fp.id)?.tiers || []),
      };
    });

    // Routine Tasks (Reconstructed from activity instances and definitions)
    const tasks: RoutineTask[] = schema.activity_instances.map(inst => {
      const def = activities.find(a => a.id === inst.activityDefinitionId);
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

    // Dynamic Allocations
    const dynamicAllocations: DynamicAllocation[] = schema.allocations.map(al => ({
      activityId: al.activityDefinitionId,
      instanceId: al.activityInstanceId,
      title: al.title,
      originalStartMinutes: al.originalStartMinutes,
      originalEndMinutes: al.originalEndMinutes,
      allocatedStartMinutes: al.allocatedStartMinutes,
      allocatedEndMinutes: al.allocatedEndMinutes,
      durationMinutes: al.durationMinutes,
      isCompressed: al.isCompressed,
      isFallback: al.isFallback,
      fallbackLevel: al.fallbackLevel,
      isProtected: al.isProtected,
      priority: al.priority,
      reasonForAdjustment: al.reasonForAdjustment,
      dependencyStatus: al.dependencyStatus,
    }));

    // Dependencies
    const dependencies: ActivityDependency[] = schema.dependencies.map(d => ({
      id: d.id,
      sourceActivityId: d.sourceActivityId,
      targetActivityId: d.targetActivityId,
      type: d.type,
      description: d.description,
      isMandatory: d.isMandatory,
    }));

    // Deviations
    const deviations: DeviationRecord[] = schema.deviations.map(d => ({
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

    // Interventions
    const interventions: InterventionRecord[] = schema.interventions.map(i => ({
      id: i.id,
      timestamp: i.executedAtUtc,
      deviationId: i.deviationId,
      actionTaken: i.actionTaken,
      description: i.description,
      resultStatus: i.resultStatus,
      humanApprovalRequired: i.humanApprovalRequired,
      humanApproved: i.humanApproved,
    }));

    // Active Human Decision
    let activeHumanDecision: HumanDecisionRequest | null = null;
    const pendingDecision = schema.decisions.find(d => d.resolutionStatus === 'PENDING');
    if (pendingDecision) {
      const candidates = schema.decision_candidates
        .filter(c => c.contextId === pendingDecision.contextId)
        .map(c => ({
          id: c.optionKey,
          label: c.label,
          description: c.description,
          consequence: c.consequence,
        }));

      activeHumanDecision = {
        id: pendingDecision.id,
        title: pendingDecision.title,
        description: pendingDecision.description,
        reason: pendingDecision.reason,
        urgency: pendingDecision.urgency,
        options: candidates,
        createdAt: pendingDecision.createdAtUtc,
      };
    }

    // Adaptation Patterns
    const adaptationPatterns: AdaptationPattern[] = schema.adaptation_patterns.map(p => ({
      id: p.id,
      activityId: p.activityId,
      patternType: p.patternType as any,
      evidenceCount: p.evidenceCount,
      failureRatePercent: p.failureRatePercent,
      hypothesis: p.hypothesis,
      detectedAt: p.detectedAtUtc,
    }));

    // Adaptation Proposals
    const adaptationProposals: AdaptationProposal[] = schema.adaptation_proposals.map(p => ({
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

    // User Overrides
    const userOverrides: UserOverrideRecord[] = schema.overrides.map(o => ({
      id: o.id,
      timestamp: o.occurredAtUtc,
      activityId: o.activityId,
      overrideType: o.overrideType,
      reason: o.reason,
      previousState: o.previousState,
      newState: o.newState,
    }));

    // System Events
    const events: SystemEvent[] = schema.event_records.map(e => ({
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

    // Rewards
    const rewards: Reward[] = schema.reward_definitions.map(r => ({
      id: r.id,
      title: r.title,
      description: r.description,
      category: r.category,
      pointsRequired: r.pointsRequired,
      unlocked: r.unlocked,
      redeemed: r.redeemed,
      redeemedAt: r.redeemedAtUtc,
    }));

    // Day Histories
    const history: DayHistoryRecord[] = schema.day_histories.map(h => ({
      date: h.date,
      score: h.score,
      mode: h.mode,
      dayType: h.dayType,
      pillars: h.pillars,
      topVictory: h.topVictory,
      reflectionSummary: h.reflectionSummary,
    }));

    // Construct base app state
    const reconstructed: AppState = {
      ...(fallback || ({} as AppState)),
      currentMode,
      dayType,
      routineState,
      routineChangeReason,
      autonomyLevel,
      strictTimeEnforcement,
      isSimulatedTime: fallback?.isSimulatedTime ?? false,
      simulatedTime: fallback?.simulatedTime ?? '05:30',
      tasks: tasks.length > 0 ? tasks : (fallback?.tasks || []),
      activities: activities.length > 0 ? activities : (fallback?.activities || []),
      activityInstances: [],
      dependencies: dependencies.length > 0 ? dependencies : (fallback?.dependencies || []),
      fallbackPolicies: fallbackPolicies.length > 0 ? fallbackPolicies : (fallback?.fallbackPolicies || []),
      dynamicAllocations: dynamicAllocations.length > 0 ? dynamicAllocations : (fallback?.dynamicAllocations || []),
      deviations: deviations.length > 0 ? deviations : (fallback?.deviations || []),
      interventions: interventions.length > 0 ? interventions : (fallback?.interventions || []),
      adaptationPatterns: adaptationPatterns.length > 0 ? adaptationPatterns : (fallback?.adaptationPatterns || []),
      adaptationProposals: adaptationProposals.length > 0 ? adaptationProposals : (fallback?.adaptationProposals || []),
      userOverrides: userOverrides.length > 0 ? userOverrides : (fallback?.userOverrides || []),
      events: events.length > 0 ? events : (fallback?.events || []),
      activeHumanDecision,
      autonomousResolutionCount,
      identityStatus: profile?.identityStatus || fallback?.identityStatus || {
        rememberedDream: false,
        rememberedWho: false,
        rememberedWhere: false,
        rememberedWhatBuilding: false,
        completedToday: false,
      },
      tradingProtocol: profile?.tradingProtocol || fallback?.tradingProtocol || {
        isTradingDay: false,
        marketAnalyzed: false,
        setupDetected: false,
        setupName: '',
        strategyCriteriaMet: false,
        riskLimitsSatisfied: false,
        stopLossDefined: false,
        executed: false,
        tradeNotes: '',
        closedTerminal: false,
        noSetupJustified: false,
      },
      companyOfTheDay: profile?.companyOfTheDay || fallback?.companyOfTheDay || {
        companyName: '',
        objective: '',
        targetOutcome: '',
        actions: [],
      },
      dailyReview: profile?.dailyReview || fallback?.dailyReview || {
        date: '',
        accomplished: '',
        failed: '',
        why: '',
        learned: '',
        priorityTomorrow: '',
        gratitude: '',
      },
      tomorrowPlan: profile?.tomorrowPlan || fallback?.tomorrowPlan || {
        top3: ['', '', ''],
        scheduleFocus: '',
        plannedMeal: '',
        workoutType: '',
        companyPriority: '',
        familyActivity: '',
        tradingConditions: '',
      },
      dreamEntries: fallback?.dreamEntries || [],
      rewardPoints,
      rewards: rewards.length > 0 ? rewards : (fallback?.rewards || []),
      history: history.length > 0 ? history : (fallback?.history || []),
      activeView: (profile?.activeView as any) || fallback?.activeView || 'DASHBOARD',
      pointsAwardedTasks: fallback?.pointsAwardedTasks || [],
      performanceSessions: schema.performance_sessions.length
        ? schema.performance_sessions.map(session => ({ ...session }))
        : (fallback?.performanceSessions || []),
      activePerformanceSessionId: fallback?.activePerformanceSessionId || null,
      dailyPerformanceRecords: schema.daily_performance_records.length
        ? schema.daily_performance_records.map(({ version: _v, updatedAtUtc: _u, ...record }) => record)
        : (fallback?.dailyPerformanceRecords || []),
      weeklyPerformanceRecords: schema.weekly_performance_records.length
        ? schema.weekly_performance_records.map(({ version: _v, updatedAtUtc: _u, ...record }) => record)
        : (fallback?.weeklyPerformanceRecords || []),
      dayOfWeekPerformanceProfiles: schema.day_of_week_performance_profiles.length
        ? schema.day_of_week_performance_profiles.map(({ version: _v, createdAtUtc: _c, ...profileRecord }) => profileRecord)
        : (fallback?.dayOfWeekPerformanceProfiles || []),
      weeklyInsights: schema.weekly_insights.length
        ? schema.weekly_insights.map(({ userId: _uid, version: _v, createdAtUtc: _c, updatedAtUtc: _u, ...insight }) => insight)
        : (fallback?.weeklyInsights || []),
      weeklyAdaptationRecommendations: schema.weekly_adaptation_recommendations.length
        ? schema.weekly_adaptation_recommendations.map(({ userId: _uid, version: _v, updatedAtUtc: _u, ...recommendation }) => recommendation)
        : (fallback?.weeklyAdaptationRecommendations || []),
      activeTimers: fallback?.activeTimers || {
        outdoorLight: { isRunning: false, startedAt: null, accumulatedSeconds: 0, targetSeconds: 600 },
        meditation: { isRunning: false, startedAt: null, accumulatedSeconds: 0, targetSeconds: 1800 },
        deepWork: { isRunning: false, startedAt: null, accumulatedSeconds: 0, targetSeconds: 5400, soundType: 'NONE' },
      },
      focusSession: fallback?.focusSession || {
        isActive: false,
        durationMinutes: 90,
        startedAt: null,
        soundType: 'NONE',
        taskLabel: 'Deep Work Block',
      },
      victoryQuestionAnswer: profile?.victoryQuestionAnswer || fallback?.victoryQuestionAnswer || '',
      morningWorkoutSetsDone: fallback?.morningWorkoutSetsDone || 0,
      afternoonWorkoutSetsDone: fallback?.afternoonWorkoutSetsDone || 0,
      morningOutdoorMinutes: fallback?.morningOutdoorMinutes || 0,
      meditationMinutes: fallback?.meditationMinutes || 0,
      disciplinePenaltiesCount,
    };

    // Restore any extra raw fields from legacy_raw_metadata
    schema.legacy_raw_metadata.forEach(legacy => {
      (reconstructed as any)[legacy.key] = legacy.rawPayload;
    });

    return reconstructed;
  }
}
