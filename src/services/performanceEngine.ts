import {
  PerformanceSession,
  PerformanceSessionStatus,
  PerformanceStep,
  PerformanceStepExecution,
  PerformanceEvidence,
  PerformanceArtifact,
  PerformanceInterruption,
  PerformanceExtensionRequest,
  PerformanceEnvironmentConfig,
  PerformanceQualityAssessment,
  PerformanceOutcomeResult,
  ExecutionEnvironmentType,
  CompletionPolicyType,
  EvidenceLevel,
  AIMode,
  AppState,
  RoutineTask,
  PerformanceProtocol
} from '../types';
import { defaultClock, IClock } from '../clock';
import { CANONICAL_PERFORMANCE_PROTOCOLS, getProtocolForActivity } from '../data/performanceProtocols';
import { defaultEventDispatcher } from './eventDispatcher';
import { evaluatePerformanceExtensionAllocation } from './allocationEngine';

function publishPerformanceEvent(event: {
  event_type: any;
  actor: any;
  subject: any;
  payload: any;
  metadata?: any;
}) {
  try {
    const sysEvt = {
      event_id: `evt-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      event_version: '1.0.0',
      occurred_at: new Date().toISOString(),
      scope: 'HEE_PERFORMANCE',
      metadata: {
        currentMinutes: defaultClock.getCurrentTimeMinutes(),
        mode: 'GREEN' as const,
        routineState: 'STANDARD' as const,
        ...(event.metadata || {})
      },
      ...event
    };
    defaultEventDispatcher.dispatch(sysEvt as any).catch(() => {});
  } catch {
    // Non-blocking in-memory dispatch
  }
}

function canonicalPerformanceActivityType(task: RoutineTask): string {
  switch (task.interactiveActionType) {
    case 'FOCUS_BLOCK':
    case 'COMPANY_TARGET':
      return 'DEEP_WORK';
    case 'WORKOUT_TRACKER':
      return 'WORKOUT';
    case 'MEDITATION_TIMER':
      return 'MEDITATION';
    case 'OUTSIDE_TIMER':
    case 'IDENTITY_CHECK':
      return 'MORNING_LIGHT';
    case 'TRADING_GATEKEEPER':
      return 'EXTERNAL_GATED';
    case 'FAMILY_OUTING':
      return 'PRESENCE';
    default:
      return task.interactiveActionType || task.category || task.anchorId || 'GENERIC';
  }
}

export class HumanPerformanceEngine {
  constructor(private readonly clock: IClock = defaultClock) {}

  /**
   * Environment Resolver
   * Resolves execution environment based on activity definition, context, and capability.
   */
  public resolveEnvironment(task: RoutineTask, customPreference?: ExecutionEnvironmentType): ExecutionEnvironmentType {
    if (customPreference) return customPreference;

    const action = task.interactiveActionType;
    switch (action) {
      case 'FOCUS_BLOCK':
        return 'ASSISTED';
      case 'WORKOUT_TRACKER':
      case 'MEDITATION_TIMER':
      case 'OUTSIDE_TIMER':
        return 'GUIDED';
      case 'TRADING_GATEKEEPER':
        return 'GUIDED';
      case 'FAMILY_OUTING':
        return 'EXTERNAL';
      case 'EVENING_REVIEW':
      case 'DREAM_JOURNAL':
      case 'IDENTITY_CHECK':
      case 'COMMAND_CENTER':
        return 'IN_APP';
      default:
        if (task.title.toLowerCase().includes('meeting') || task.title.toLowerCase().includes('doctor') || task.title.toLowerCase().includes('flight')) {
          return 'EXTERNAL';
        }
        return 'IN_APP';
    }
  }

  /**
   * Environment Configuration Builder
   */
  public getEnvironmentConfig(
    environmentType: ExecutionEnvironmentType,
    task: RoutineTask
  ): PerformanceEnvironmentConfig {
    const isProtectedFamily = task.interactiveActionType === 'FAMILY_OUTING' || task.isProtected;

    return {
      environmentType,
      allowedTools: environmentType === 'ASSISTED' ? ['CODE_EDITOR', 'NOTES', 'AI_PARTNER', 'BROWSER_RESTRICTED'] : ['CHECKLIST', 'TIMER'],
      aiMode: isProtectedFamily ? 'SILENT' : (environmentType === 'ASSISTED' ? 'COACH' : 'SILENT'),
      screenAwayPolicy: (environmentType === 'EXTERNAL' || environmentType === 'PHYSICAL') ? 'ENCOURAGE_OFFLINE' : 'NONE',
      distractionShieldEnabled: environmentType === 'ASSISTED',
      ambientSoundAllowed: environmentType === 'ASSISTED' || environmentType === 'GUIDED'
    };
  }

  /**
   * Create a new PerformanceSession for an eligible activity
   */
  public createSession(
    state: AppState,
    activityInstanceId: string,
    options?: {
      environmentType?: ExecutionEnvironmentType;
      protocolId?: string;
      userId?: string;
    }
  ): PerformanceSession {
    const task = state.tasks.find(t => t.id === activityInstanceId);
    if (!task) {
      throw new Error(`ActivityInstance ${activityInstanceId} not found in current execution state.`);
    }

    const nowUtc = this.clock.toISOString();
    const resolvedEnv = this.resolveEnvironment(task, options?.environmentType);
    const canonicalActivityType = canonicalPerformanceActivityType(task);
    const protocol = options?.protocolId
      ? (CANONICAL_PERFORMANCE_PROTOCOLS.find(p => p.id === options.protocolId) || getProtocolForActivity(canonicalActivityType, resolvedEnv))
      : getProtocolForActivity(canonicalActivityType, resolvedEnv);

    const stepExecutions: PerformanceStepExecution[] = protocol.steps.map((step, idx) => ({
      stepId: step.id,
      stepType: step.type,
      title: step.title,
      status: idx === 0 ? 'READY' : 'PENDING',
      accumulatedSeconds: 0
    }));

    const session: PerformanceSession = {
      id: `perf-session-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      userId: options?.userId || 'usr-default-owner',
      activityInstanceId: task.id,
      activityDefinitionId: task.anchorId || task.id,
      routineVersionId: (state as any).routineVersionId || 'legacy-v1',
      title: task.title,
      objective: task.notes || task.title,
      environmentType: resolvedEnv,
      protocolId: protocol.id,
      protocolVersion: protocol.version,
      status: 'CREATED',
      effectiveAllocationStartMinutes: task.allocatedStartMinutes ?? task.startMinutes,
      effectiveAllocationEndMinutes: task.allocatedEndMinutes ?? task.endMinutes,
      targetDurationMinutes: protocol.targetDurationMinutes || (task.endMinutes - task.startMinutes) || 30,
      minimumDurationMinutes: protocol.minimumDurationMinutes || 10,
      activeDurationSeconds: 0,
      pausedDurationSeconds: 0,
      currentStepIndex: 0,
      stepExecutions,
      interruptions: [],
      evidence: [],
      artifacts: [],
      extensionRequests: [],
      environmentConfig: this.getEnvironmentConfig(resolvedEnv, task),
      createdBy: 'USER',
      version: 1,
      createdAtUtc: nowUtc,
      updatedAtUtc: nowUtc
    };

    publishPerformanceEvent({
      event_type: 'PerformanceSessionCreated',
      actor: { type: 'USER', id: session.userId },
      subject: { type: 'ACTIVITY_INSTANCE', id: task.id },
      payload: { sessionId: session.id, environment: resolvedEnv, protocolId: protocol.id }
    });

    return session;
  }

  /**
   * Transition session into PREPARING state
   */
  public prepareSession(session: PerformanceSession): PerformanceSession {
    if (session.status !== 'CREATED') {
      throw new Error(`Cannot prepare session in status ${session.status}. Expected CREATED.`);
    }

    const nowUtc = this.clock.toISOString();

    const updated = {
      ...session,
      status: 'PREPARING' as PerformanceSessionStatus,
      version: session.version + 1,
      updatedAtUtc: nowUtc
    };

    publishPerformanceEvent({
      event_type: 'PerformancePreparationStarted',
      actor: { type: 'USER', id: session.userId },
      subject: { type: 'ACTIVITY_INSTANCE', id: session.activityInstanceId },
      payload: { sessionId: session.id }
    });

    return updated;
  }

  /**
   * Transition session into READY_TO_START after prep ritual is satisfied
   */
  public readySession(session: PerformanceSession): PerformanceSession {
    if (session.status !== 'PREPARING' && session.status !== 'CREATED') {
      throw new Error(`Cannot mark ready session in status ${session.status}.`);
    }

    const nowUtc = this.clock.toISOString();

    const updated = {
      ...session,
      status: 'READY_TO_START' as PerformanceSessionStatus,
      version: session.version + 1,
      updatedAtUtc: nowUtc
    };

    publishPerformanceEvent({
      event_type: 'PerformanceReady',
      actor: { type: 'USER', id: session.userId },
      subject: { type: 'ACTIVITY_INSTANCE', id: session.activityInstanceId },
      payload: { sessionId: session.id }
    });

    return updated;
  }

  /**
   * Start Authoritative Active Execution
   */
  public startSession(session: PerformanceSession): PerformanceSession {
    if (session.status !== 'READY_TO_START' && session.status !== 'PREPARING' && session.status !== 'CREATED') {
      throw new Error(`Invalid state transition: Cannot start session from status ${session.status}`);
    }

    const nowUtc = this.clock.toISOString();

    const stepExecutions = session.stepExecutions.map((step, idx) => {
      if (idx === 0) {
        return { ...step, status: 'ACTIVE' as const, startedAtUtc: nowUtc };
      }
      return step;
    });

    const updated: PerformanceSession = {
      ...session,
      status: 'ACTIVE',
      startedAtUtc: session.startedAtUtc || nowUtc,
      resumedAtUtc: nowUtc,
      lastTickAtUtc: nowUtc,
      stepExecutions,
      version: session.version + 1,
      updatedAtUtc: nowUtc
    };

    publishPerformanceEvent({
      event_type: 'PerformanceSessionStarted',
      actor: { type: 'USER', id: session.userId },
      subject: { type: 'ACTIVITY_INSTANCE', id: session.activityInstanceId },
      payload: { sessionId: session.id, protocolId: session.protocolId }
    });

    return updated;
  }

  /**
   * Pause Active Session
   */
  public pauseSession(session: PerformanceSession, reason?: string): PerformanceSession {
    if (session.status !== 'ACTIVE') {
      throw new Error(`Cannot pause session in status ${session.status}`);
    }

    const nowUtc = this.clock.toISOString();
    const reconciled = this.reconcileSessionTiming(session, nowUtc);

    const interruption: PerformanceInterruption = {
      id: `int-${Date.now()}`,
      interruptionType: 'PAUSE',
      startedAtUtc: nowUtc,
      reason: reason || 'User paused session'
    };

    const updated: PerformanceSession = {
      ...reconciled,
      status: 'PAUSED',
      resumedAtUtc: undefined,
      interruptions: [...reconciled.interruptions, interruption],
      version: session.version + 1,
      updatedAtUtc: nowUtc
    };

    publishPerformanceEvent({
      event_type: 'PerformanceSessionPaused',
      actor: { type: 'USER', id: session.userId },
      subject: { type: 'ACTIVITY_INSTANCE', id: session.activityInstanceId },
      payload: { sessionId: session.id, reason }
    });

    return updated;
  }

  /**
   * Resume Paused Session
   */
  public resumeSession(session: PerformanceSession): PerformanceSession {
    if (session.status !== 'PAUSED') {
      throw new Error(`Cannot resume session in status ${session.status}`);
    }

    const nowUtc = this.clock.toISOString();

    // Close open interruption
    const interruptions = session.interruptions.map(int => {
      if (!int.endedAtUtc) {
        const durationSec = Math.max(0, Math.floor((new Date(nowUtc).getTime() - new Date(int.startedAtUtc).getTime()) / 1000));
        return {
          ...int,
          endedAtUtc: nowUtc,
          durationSeconds: durationSec
        };
      }
      return int;
    });

    const lastInt = interruptions[interruptions.length - 1];
    const addedPaused = lastInt?.durationSeconds || 0;

    const updated: PerformanceSession = {
      ...session,
      status: 'ACTIVE',
      resumedAtUtc: nowUtc,
      lastTickAtUtc: nowUtc,
      pausedDurationSeconds: session.pausedDurationSeconds + addedPaused,
      interruptions,
      version: session.version + 1,
      updatedAtUtc: nowUtc
    };

    publishPerformanceEvent({
      event_type: 'PerformanceSessionResumed',
      actor: { type: 'USER', id: session.userId },
      subject: { type: 'ACTIVITY_INSTANCE', id: session.activityInstanceId },
      payload: { sessionId: session.id }
    });

    return updated;
  }

  /**
   * Step Progress & Advance
   */
  public advanceStep(
    session: PerformanceSession,
    stepIndex: number,
    progressData?: {
      completed?: boolean;
      quantity?: number;
      branchSelectedId?: string;
      notes?: string;
    }
  ): PerformanceSession {
    if (session.status !== 'ACTIVE' && session.status !== 'READY_TO_START') {
      throw new Error(`Cannot advance step in session status ${session.status}`);
    }

    const nowUtc = this.clock.toISOString();
    const step = session.stepExecutions[stepIndex];
    if (!step) {
      throw new Error(`Step index ${stepIndex} out of bounds.`);
    }

    const updatedSteps = session.stepExecutions.map((s, idx) => {
      if (idx === stepIndex) {
        return {
          ...s,
          status: 'COMPLETED' as const,
          completedAtUtc: nowUtc,
          quantityCompleted: progressData?.quantity,
          branchSelectedId: progressData?.branchSelectedId,
          notes: progressData?.notes
        };
      }
      if (idx === stepIndex + 1) {
        return {
          ...s,
          status: 'ACTIVE' as const,
          startedAtUtc: nowUtc
        };
      }
      return s;
    });

    const nextIndex = Math.min(updatedSteps.length - 1, stepIndex + 1);

    const updated: PerformanceSession = {
      ...session,
      currentStepIndex: nextIndex,
      stepExecutions: updatedSteps,
      version: session.version + 1,
      updatedAtUtc: nowUtc
    };

    publishPerformanceEvent({
      event_type: 'PerformanceStepCompleted',
      actor: { type: 'USER', id: session.userId },
      subject: { type: 'ACTIVITY_INSTANCE', id: session.activityInstanceId },
      payload: { sessionId: session.id, stepIndex, stepId: step.stepId }
    });

    return updated;
  }

  /**
   * Attach Artifact (Code file, notes, schema, design)
   */
  public attachArtifact(
    session: PerformanceSession,
    artifactData: {
      artifactType: string;
      title: string;
      uriOrRef?: string;
      contentSnippet?: string;
      provenance?: string;
    }
  ): PerformanceSession {
    const nowUtc = this.clock.toISOString();

    const artifact: PerformanceArtifact = {
      id: `art-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      sessionId: session.id,
      artifactType: artifactData.artifactType as any,
      title: artifactData.title,
      uriOrRef: artifactData.uriOrRef,
      contentSnippet: artifactData.contentSnippet,
      provenance: (artifactData.provenance as any) || 'USER_AUTHORED',
      createdAtUtc: nowUtc
    };

    const updated: PerformanceSession = {
      ...session,
      artifacts: [...session.artifacts, artifact],
      version: session.version + 1,
      updatedAtUtc: nowUtc
    };

    publishPerformanceEvent({
      event_type: 'PerformanceArtifactAttached',
      actor: { type: 'USER', id: session.userId },
      subject: { type: 'ACTIVITY_INSTANCE', id: session.activityInstanceId },
      payload: { sessionId: session.id, artifactId: artifact.id, title: artifact.title }
    });

    return updated;
  }

  /**
   * Record Verification Evidence
   */
  public recordEvidence(
    session: PerformanceSession,
    evidenceData: {
      type: string;
      source: 'SYSTEM' | 'USER' | 'INTEGRATION' | 'EXTERNAL_SENSOR';
      trustLevel: EvidenceLevel;
      payload: Record<string, any>;
    }
  ): PerformanceSession {
    const nowUtc = this.clock.toISOString();

    const evidence: PerformanceEvidence = {
      id: `evi-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      sessionId: session.id,
      type: evidenceData.type,
      source: evidenceData.source,
      trustLevel: evidenceData.trustLevel,
      isValid: true,
      capturedAtUtc: nowUtc,
      payload: evidenceData.payload
    };

    const updated: PerformanceSession = {
      ...session,
      evidence: [...session.evidence, evidence],
      version: session.version + 1,
      updatedAtUtc: nowUtc
    };

    publishPerformanceEvent({
      event_type: 'PerformanceEvidenceCaptured',
      actor: { type: 'USER', id: session.userId },
      subject: { type: 'ACTIVITY_INSTANCE', id: session.activityInstanceId },
      payload: { sessionId: session.id, evidenceId: evidence.id, type: evidence.type }
    });

    return updated;
  }

  /**
   * Request Performance Extension (Need More Time)
   * Evaluates downstream schedule and protected commitments via HEE-003 / HEE-010.
   */
  public requestExtension(
    state: AppState,
    session: PerformanceSession,
    requestedMinutes: number,
    reason: string
  ): {
    updatedState: AppState;
    updatedSession: PerformanceSession;
    approved: boolean;
    reasonText: string;
  } {
    const nowUtc = this.clock.toISOString();
    const allocationDecision = evaluatePerformanceExtensionAllocation(
      state,
      session.activityInstanceId,
      requestedMinutes
    );

    const extensionReq: PerformanceExtensionRequest = {
      id: `ext-${Date.now()}`,
      sessionId: session.id,
      requestedMinutes,
      reason,
      status: allocationDecision.approved ? 'APPROVED' : 'DENIED',
      evaluatedAtUtc: nowUtc,
      governanceDecisionReason: allocationDecision.reason,
      resultingAllocatedEndMinutes: allocationDecision.resultingAllocatedEndMinutes,
    };

    const updatedSession: PerformanceSession = {
      ...session,
      extensionRequests: [...session.extensionRequests, extensionReq],
      effectiveAllocationEndMinutes: allocationDecision.approved
        ? allocationDecision.resultingAllocatedEndMinutes || session.effectiveAllocationEndMinutes
        : session.effectiveAllocationEndMinutes,
      targetDurationMinutes: allocationDecision.approved
        ? session.targetDurationMinutes + requestedMinutes
        : session.targetDurationMinutes,
      version: session.version + 1,
      updatedAtUtc: nowUtc,
    };

    const updatedState: AppState = {
      ...allocationDecision.state,
      performanceSessions: (allocationDecision.state.performanceSessions || []).map(s =>
        s.id === updatedSession.id ? updatedSession : s
      ),
    };

    return {
      updatedState,
      updatedSession,
      approved: allocationDecision.approved,
      reasonText: allocationDecision.reason,
    };
  }

  /**
   * Close Performance Session & Evaluate Outcome
   */
  public closeSession(
    session: PerformanceSession,
    userReportedOutcome: 'COMPLETED' | 'PARTIAL' | 'BLOCKED' | 'ABANDONED',
    options?: {
      qualityAssessment?: PerformanceQualityAssessment;
      reason?: string;
    }
  ): {
    updatedSession: PerformanceSession;
    outcomeResult: PerformanceOutcomeResult;
  } {
    const nowUtc = this.clock.toISOString();

    // Final timing reconciliation
    const reconciled = this.reconcileSessionTiming(session, nowUtc);
    const activeMins = Math.floor(reconciled.activeDurationSeconds / 60);

    let finalOutcome: 'COMPLETED' | 'PARTIAL' | 'BLOCKED' | 'ABANDONED' | 'INCONCLUSIVE' = userReportedOutcome;
    let reason = options?.reason || `Session closed with ${userReportedOutcome}.`;
    let completionPercentage = 100;

    const protocol = session.protocolId
      ? CANONICAL_PERFORMANCE_PROTOCOLS.find(p => p.id === session.protocolId)
      : undefined;
    const requiredEvidenceRank: Record<EvidenceLevel, number> = { E0: 0, E1: 1, E2: 2, E3: 3, E4: 4 };
    const validEvidenceRank = reconciled.evidence
      .filter(e => e.isValid)
      .reduce((max, e) => Math.max(max, requiredEvidenceRank[e.trustLevel] ?? 0), 0);
    const requiredRank = protocol ? requiredEvidenceRank[protocol.evidencePolicy.requiredLevel] : 0;

    const requiredProtocolSteps = (protocol?.steps || []).filter(step => !step.isOptional && step.type !== 'CLOSE');
    const protocolStepsMet = requiredProtocolSteps.every(step => {
      const execution = reconciled.stepExecutions.find(s => s.stepId === step.id);
      if (!execution || execution.status !== 'COMPLETED') return false;
      if (step.requiredQuantity !== undefined && (execution.quantityCompleted || 0) < step.requiredQuantity) return false;
      return true;
    });

    const evidenceMet =
      requiredRank === 0 ||
      validEvidenceRank >= requiredRank ||
      (requiredRank === 1 && reconciled.activeDurationSeconds > 0);

    const minimumDurationMet = !reconciled.minimumDurationMinutes || activeMins >= reconciled.minimumDurationMinutes;
    const policy = protocol?.completionPolicy || 'BINARY_CONFIRMATION';

    let policyMet = true;
    if (policy === 'MINIMUM_DURATION' || policy === 'TARGET_DURATION') {
      policyMet = minimumDurationMet;
    } else if (policy === 'QUANTITY') {
      policyMet = protocolStepsMet;
    } else if (policy === 'PROTOCOL') {
      policyMet = protocolStepsMet && evidenceMet;
    } else if (policy === 'OUTCOME') {
      policyMet = evidenceMet || reconciled.artifacts.length > 0 || Boolean(options?.qualityAssessment?.score);
    } else if (policy === 'INTEGRATION_EVIDENCE') {
      policyMet = validEvidenceRank >= requiredEvidenceRank.E3;
    } else if (policy === 'COMPOSITE') {
      policyMet = minimumDurationMet && protocolStepsMet && evidenceMet;
    }

    if (userReportedOutcome === 'COMPLETED' && !policyMet) {
      finalOutcome = 'PARTIAL';
      const durationPercent = reconciled.minimumDurationMinutes
        ? Math.round((activeMins / Math.max(1, reconciled.minimumDurationMinutes)) * 100)
        : 50;
      completionPercentage = Math.min(90, Math.max(1, durationPercent));
      reason = `Completion policy ${policy} was not satisfied. Required protocol/evidence remains incomplete.`;
    } else if (userReportedOutcome === 'COMPLETED') {
      completionPercentage = 100;
    } else if (userReportedOutcome === 'PARTIAL') {
      completionPercentage = Math.min(90, Math.round((activeMins / Math.max(1, reconciled.targetDurationMinutes)) * 100));
    } else if (userReportedOutcome === 'BLOCKED') {
      completionPercentage = 0;
      reason = session.blockerReason || 'Execution was blocked.';
    } else if (userReportedOutcome === 'ABANDONED') {
      completionPercentage = 0;
    }

    const releasedMinutes = Math.max(0, reconciled.targetDurationMinutes - activeMins);

    const outcomeResult: PerformanceOutcomeResult = {
      outcome: finalOutcome,
      reason,
      completionPercentage,
      activeDurationSeconds: reconciled.activeDurationSeconds,
      pausedDurationSeconds: reconciled.pausedDurationSeconds,
      evidenceMet: finalOutcome === 'COMPLETED' ? true : reconciled.evidence.some(e => e.isValid),
      releasedMinutes: (finalOutcome === 'COMPLETED' && releasedMinutes > 0) ? releasedMinutes : undefined
    };

    const updatedSession: PerformanceSession = {
      ...reconciled,
      status: finalOutcome === 'COMPLETED' ? 'COMPLETED' : (finalOutcome === 'PARTIAL' ? 'PARTIAL' : (finalOutcome === 'BLOCKED' ? 'BLOCKED' : 'ABANDONED')),
      endedAtUtc: nowUtc,
      qualityAssessment: options?.qualityAssessment,
      completionResult: outcomeResult,
      version: session.version + 1,
      updatedAtUtc: nowUtc
    };

    publishPerformanceEvent({
      event_type: 'PerformanceOutcomeEvaluated',
      actor: { type: 'ENGINE', id: 'hee-011-performance' },
      subject: { type: 'ACTIVITY_INSTANCE', id: session.activityInstanceId },
      payload: { sessionId: session.id, outcome: finalOutcome, activeDurationSeconds: reconciled.activeDurationSeconds, completionPercentage }
    });

    return {
      updatedSession,
      outcomeResult
    };
  }

  /**
   * Cancel Session before meaningful performance
   */
  public cancelSession(session: PerformanceSession, reason: string): PerformanceSession {
    if (session.status === 'COMPLETED' || session.status === 'PARTIAL') {
      throw new Error(`Cannot cancel already committed session in status ${session.status}.`);
    }

    const nowUtc = this.clock.toISOString();

    return {
      ...session,
      status: 'CANCELLED',
      endedAtUtc: nowUtc,
      blockerReason: reason,
      version: session.version + 1,
      updatedAtUtc: nowUtc
    };
  }

  /**
   * Reconciles Authoritative Active & Paused duration from UTC timestamps
   * Ensures React reload / background tab sleep never skews or fabricates duration.
   */
  public reconcileSessionTiming(session: PerformanceSession, currentUtcIso?: string): PerformanceSession {
    if (session.status !== 'ACTIVE' && session.status !== 'PAUSED') {
      return session;
    }

    const nowUtc = currentUtcIso || defaultClock.toISOString();
    const nowTime = new Date(nowUtc).getTime();

    let additionalActive = 0;
    if (session.status === 'ACTIVE' && session.resumedAtUtc) {
      const resumeTime = new Date(session.resumedAtUtc).getTime();
      additionalActive = Math.max(0, Math.floor((nowTime - resumeTime) / 1000));
    }

    return {
      ...session,
      activeDurationSeconds: session.activeDurationSeconds + additionalActive,
      resumedAtUtc: session.status === 'ACTIVE' ? nowUtc : session.resumedAtUtc,
      lastTickAtUtc: nowUtc
    };
  }
}

export const performanceEngine = new HumanPerformanceEngine();
