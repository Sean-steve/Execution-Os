import { AppState, SystemEvent } from '../types';
import { ExecutionApplicationService } from '../services/executionApplicationService';
import { IHOSRepositoryFactory } from './repositoryFactory';
import { HOSSubjectContext, HOSIdentityBridge } from './identityBridge';
import { HOS_ENGINE_CAPABILITIES } from './engineManifest';
import { HOSEventMeshBridge } from './eventMesh';
import { HOSEngineLifecycleRegistry } from './lifecycle';
import { IHOSBoundaryStore, MemoryHOSBoundaryStore } from './boundaryStore';

export interface HOSCapabilityResult {
  capability: string;
  subjectId: string;
  tenantId: string;
  data: any;
  events: SystemEvent[];
  idempotentReplay?: boolean;
}

interface IdempotencyRecord {
  fingerprint: string;
  result: HOSCapabilityResult;
}

const stable = (value: any): string => {
  const normalize = (input: any): any => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === 'object') {
      return Object.keys(input).sort().reduce((out, key) => {
        out[key] = normalize(input[key]);
        return out;
      }, {} as Record<string, any>);
    }
    return input;
  };
  return JSON.stringify(normalize(value));
};

export class HOSCapabilityService {
  constructor(
    private repositories: IHOSRepositoryFactory,
    private eventMesh: HOSEventMeshBridge,
    private lifecycle: HOSEngineLifecycleRegistry,
    private boundaryStore: IHOSBoundaryStore = new MemoryHOSBoundaryStore()
  ) {}

  private definition(name: string) {
    const definition = HOS_ENGINE_CAPABILITIES.find(capability => capability.name === name);
    if (!definition) throw new Error(`Unsupported HOS capability "${name}".`);
    return definition;
  }

  private async bindSubject(state: AppState, subject: HOSSubjectContext): Promise<AppState> {
    const existingSubject = (state as any).subjectId as string | undefined;
    const existingTenant = (state as any).tenantId as string | undefined;
    const planSubject = state.scheduleAuthority?.authoritativePlan?.subjectId;

    if (existingSubject && existingSubject !== subject.subjectId) {
      throw new Error(`Repository subject mismatch: state belongs to ${existingSubject}, assertion belongs to ${subject.subjectId}.`);
    }
    if (existingTenant && existingTenant !== subject.tenantId) {
      throw new Error(`Repository tenant mismatch: state belongs to ${existingTenant}, assertion belongs to ${subject.tenantId}.`);
    }
    if (planSubject && planSubject !== subject.subjectId) {
      throw new Error(`HOS Daily Operating Plan subject mismatch: plan belongs to ${planSubject}.`);
    }

    return {
      ...state,
      subjectId: subject.subjectId,
      tenantId: subject.tenantId,
      hosIdentityBinding: {
        hosUserId: subject.hosUserId,
        tenantId: subject.tenantId,
        issuer: subject.issuer,
        boundAtUtc: (state as any).hosIdentityBinding?.boundAtUtc || new Date().toISOString(),
        lastAuthenticatedAtUtc: subject.authenticatedAtUtc,
      },
    } as AppState;
  }

  private assertDelegatedActivity(state: AppState, activityId: string): void {
    if (state.scheduleAuthority?.mode !== 'HOS') return;

    const plan = state.scheduleAuthority.authoritativePlan;
    if (!plan) {
      throw new Error('No authoritative HOS Daily Operating Plan is bound to this execution subject.');
    }

    const explicitActivityIds = new Set((plan.executionActivities || []).map(activity => activity.id));
    for (const window of plan.delegatedWindows || []) {
      for (const id of window.allowedActivityIds || []) explicitActivityIds.add(id);
    }

    if (!explicitActivityIds.has(activityId)) {
      throw new Error(`Activity "${activityId}" is not delegated by HOS plan ${plan.planId} version ${plan.planVersion}.`);
    }
  }

  private disciplineScore(state: AppState) {
    const committed = state.tasks.filter(task => task.isNonNegotiable);
    const completed = committed.filter(task => task.completed);
    const onTime = completed.filter(task => task.executionStatus === 'ON_TIME' || task.executionStatus === 'COMPLETED');
    const recovered = completed.filter(task => (task.fallbackLevel || 0) > 0 || task.executionStatus === 'FALLBACK_EXECUTED');
    const penalties = state.disciplinePenaltiesCount || 0;

    if (committed.length === 0) {
      return {
        score: 0,
        scale: 100,
        status: 'INSUFFICIENT_EVIDENCE',
        evidence: {
          committedActivities: 0,
          completedCommitments: 0,
          onTimeCommitments: 0,
          recoveredCommitments: 0,
          disciplinePenaltiesCount: penalties,
        },
        calculatedAtUtc: new Date().toISOString(),
      };
    }

    const completionRate = completed.length / committed.length;
    const onTimeRate = completed.length ? onTime.length / completed.length : 0;
    const recoveryRate = completed.length ? recovered.length / completed.length : 0;
    const score = Math.max(0, Math.min(100, Math.round(
      completionRate * 70 +
      onTimeRate * 20 +
      recoveryRate * 10 -
      Math.min(20, penalties * 2)
    )));

    return {
      score,
      scale: 100,
      status: 'MEASURED',
      evidence: {
        committedActivities: committed.length,
        completedCommitments: completed.length,
        onTimeCommitments: onTime.length,
        recoveredCommitments: recovered.length,
        disciplinePenaltiesCount: penalties,
      },
      calculatedAtUtc: new Date().toISOString(),
    };
  }

  async execute(
    name: string,
    payload: any,
    subject: HOSSubjectContext,
    idempotencyKey?: string
  ): Promise<HOSCapabilityResult> {
    const definition = this.definition(name);
    HOSIdentityBridge.requirePermission(subject, definition.permission);
    HOSIdentityBridge.requireConsent(subject, definition.consentScope);
    this.lifecycle.assertExecutable(subject);

    if (definition.idempotencyRequired && !idempotencyKey) {
      throw new Error(`Capability "${name}" requires an Idempotency-Key.`);
    }

    const scopedKey = idempotencyKey
      ? `${subject.tenantId}::${subject.subjectId}::${name}::${idempotencyKey}`
      : undefined;
    const fingerprint = stable(payload || {});
    if (scopedKey) {
      const cached = this.boundaryStore.getIdempotency(`capability::${scopedKey}`);
      if (cached) {
        if (cached.fingerprint !== fingerprint) {
          throw new Error('Idempotency key reuse detected with a different capability payload.');
        }
        return { ...(cached.response as HOSCapabilityResult), idempotentReplay: true };
      }
    }

    const repository = this.repositories.forSubject(subject);
    let state = await repository.loadState();
    state = await this.bindSubject(state, subject);
    await repository.saveState(state);

    const app = new ExecutionApplicationService(repository);
    const emitted: SystemEvent[] = [];
    let data: any;

    const run = async (descriptor: { type: string; payload?: any }) => {
      const result = await app.execute(descriptor, state);
      if (!result.success) throw new Error(result.error || `Capability command ${descriptor.type} failed.`);
      state = await this.bindSubject(result.state, subject);
      await repository.saveState(state);
      emitted.push(...(result.events || []));
      return result;
    };

    switch (name) {
      case 'schedule.get':
        data = {
          authority: state.scheduleAuthority,
          plan: state.scheduleAuthority?.authoritativePlan || null,
          allocations: state.dynamicAllocations,
          proposals: state.scheduleProposals || [],
        };
        break;

      case 'session.start': {
        if (payload?.sessionId) {
          await run({ type: 'StartPerformanceSession', payload: { sessionId: payload.sessionId } });
          data = { sessionId: payload.sessionId, session: state.performanceSessions?.find(s => s.id === payload.sessionId) || null };
          break;
        }

        if (!payload?.activityInstanceId) throw new Error('session.start requires sessionId or activityInstanceId.');
        this.assertDelegatedActivity(state, payload.activityInstanceId);
        await run({
          type: 'CreatePerformanceSession',
          payload: {
            activityInstanceId: payload.activityInstanceId,
            environmentType: payload.environmentType || 'INTEGRATED',
            protocolId: payload.protocolId,
          },
        });
        const sessionId = state.activePerformanceSessionId || state.performanceSessions?.[0]?.id;
        if (!sessionId) throw new Error('Performance session creation did not produce a session identifier.');
        await run({ type: 'PreparePerformanceSession', payload: { sessionId } });
        await run({ type: 'ReadyPerformanceSession', payload: { sessionId } });
        await run({ type: 'StartPerformanceSession', payload: { sessionId } });
        data = { sessionId, session: state.performanceSessions?.find(s => s.id === sessionId) || null };
        break;
      }

      case 'session.advance':
        if (!payload?.sessionId || payload?.stepIndex === undefined) {
          throw new Error('session.advance requires sessionId and stepIndex.');
        }
        await run({
          type: 'AdvancePerformanceStep',
          payload: {
            sessionId: payload.sessionId,
            stepIndex: payload.stepIndex,
            quantity: payload.quantity,
            branchSelectedId: payload.branchSelectedId,
            notes: payload.notes,
          },
        });
        data = { sessionId: payload.sessionId, session: state.performanceSessions?.find(s => s.id === payload.sessionId) || null };
        break;

      case 'session.close':
        if (!payload?.sessionId || !payload?.outcome) throw new Error('session.close requires sessionId and outcome.');
        await run({
          type: 'ClosePerformanceSession',
          payload: {
            sessionId: payload.sessionId,
            outcome: payload.outcome,
            reason: payload.reason,
            qualityAssessment: payload.qualityAssessment,
          },
        });
        data = { sessionId: payload.sessionId, session: state.performanceSessions?.find(s => s.id === payload.sessionId) || null };
        break;

      case 'fallback.trigger':
        if (!payload?.taskId || payload?.targetTierLevel === undefined) {
          throw new Error('fallback.trigger requires taskId and targetTierLevel.');
        }
        this.assertDelegatedActivity(state, payload.taskId);
        await run({
          type: 'TriggerFallback',
          payload: {
            taskId: payload.taskId,
            targetTierLevel: payload.targetTierLevel,
            reason: payload.reason || 'Triggered through HumanKernelOS capability contract.',
          },
        });
        data = {
          taskId: payload.taskId,
          task: state.tasks.find(task => task.id === payload.taskId) || null,
        };
        break;

      case 'discipline.score.get':
        data = this.disciplineScore(state);
        break;

      default:
        throw new Error(`Unsupported HOS capability "${name}".`);
    }

    if (emitted.length) {
      await this.eventMesh.publishBatch(emitted, subject);
    }

    const result: HOSCapabilityResult = {
      capability: name,
      subjectId: subject.subjectId,
      tenantId: subject.tenantId,
      data,
      events: emitted,
    };

    if (scopedKey) {
      this.boundaryStore.setIdempotency(`capability::${scopedKey}`, {
        fingerprint,
        response: JSON.parse(JSON.stringify(result)),
        createdAtUtc: new Date().toISOString(),
      });
    }
    return result;
  }
}
