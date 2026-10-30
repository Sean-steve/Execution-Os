import { SystemEvent, AppState } from '../types';
import { IDurableEventStore, defaultDurableEventStore } from './durableEventStore';

export interface CausalNode {
  eventId: string;
  eventType: string;
  occurredAt: string;
  actor: string;
  summary: string;
  causationId?: string;
  children: CausalNode[];
}

export interface ExecutionExplanation {
  eventId: string;
  eventType: string;
  occurredAt: string;
  // 1. WHAT HAPPENED?
  whatHappened: string;
  // 2. WHY?
  why: string;
  // 3. WHAT CAUSED IT?
  whatCausedIt: {
    rootCausationId?: string;
    immediateCausationId?: string;
    correlationId?: string;
    causalAncestry: {
      eventId: string;
      eventType: string;
      occurredAt: string;
      actor: string;
      summary: string;
    }[];
    triggerDescription: string;
  };
  // 4. WHICH ENGINE DECIDED?
  whichEngineDecided: string;
  // 5. WHICH POLICY ALLOWED IT?
  whichPolicyAllowedIt: string;
  // 6. WHAT STATE CHANGED?
  whatStateChanged: {
    summary: string;
    diff: Record<string, { before?: any; after?: any }> | Record<string, any>;
  };
  rawEvent: SystemEvent;
}

export class ExecutionAuditService {
  private eventStore: IDurableEventStore;

  constructor(eventStore: IDurableEventStore = defaultDurableEventStore) {
    this.eventStore = eventStore;
  }

  /**
   * Explains an event or schedule change, answering the 6 core questions from persisted evidence.
   */
  async explainEvent(eventId: string): Promise<ExecutionExplanation | null> {
    const event = await this.eventStore.getEventById(eventId);
    if (!event) return null;

    return this.synthesizeExplanation(event);
  }

  /**
   * Synthesizes the 6-part explainability contract for any SystemEvent.
   */
  async synthesizeExplanation(event: SystemEvent): Promise<ExecutionExplanation> {
    const causalAncestry = await this.eventStore.getCausalChain(event.event_id);
    const rootEvent = causalAncestry.length > 0 ? causalAncestry[0] : undefined;

    // 1. WHAT HAPPENED?
    const whatHappened = this.deriveWhatHappened(event);

    // 2. WHY?
    const why = this.deriveWhy(event, causalAncestry);

    // 3. WHAT CAUSED IT?
    const causalChainSummaries = causalAncestry.map(e => ({
      eventId: e.event_id,
      eventType: e.event_type,
      occurredAt: e.occurred_at,
      actor: typeof e.actor === 'string' ? e.actor : e.actor.name || e.actor.type,
      summary: this.deriveWhatHappened(e),
    }));

    let triggerDescription = 'Initiated autonomously by kernel or operator command.';
    if (causalAncestry.length > 1) {
      const parent = causalAncestry[causalAncestry.length - 2];
      triggerDescription = `Triggered directly by [${parent.event_type}] (ID: ${parent.event_id})`;
      if (rootEvent && rootEvent.event_id !== parent.event_id) {
        triggerDescription += ` originating from root cause [${rootEvent.event_type}] (ID: ${rootEvent.event_id})`;
      }
    }

    // 4. WHICH ENGINE DECIDED?
    const whichEngineDecided = this.deriveEngine(event);

    // 5. WHICH POLICY ALLOWED IT?
    const whichPolicyAllowedIt = this.derivePolicy(event);

    // 6. WHAT STATE CHANGED?
    const whatStateChanged = this.deriveStateChanged(event);

    return {
      eventId: event.event_id,
      eventType: event.event_type,
      occurredAt: event.occurred_at,
      whatHappened,
      why,
      whatCausedIt: {
        rootCausationId: rootEvent?.event_id,
        immediateCausationId: event.causation_id,
        correlationId: event.correlation_id,
        causalAncestry: causalChainSummaries,
        triggerDescription,
      },
      whichEngineDecided,
      whichPolicyAllowedIt,
      whatStateChanged,
      rawEvent: event,
    };
  }

  private deriveWhatHappened(event: SystemEvent): string {
    const p = event.payload || {};
    const subject = typeof event.subject === 'string' ? event.subject : event.subject.title || event.subject.id;

    switch (event.event_type) {
      case 'RoutineStateTransitioned':
      case 'RoutineChanged':
        return `Routine transitioned to ${p.routineState || event.metadata.routineState} mode (${p.reason || event.metadata.rationale || 'schedule adaptation'}).`;

      case 'RoutineActivated':
        return `Day execution activated with System Mode ${p.mode || event.metadata.mode} and Day Type ${p.dayType || 'STANDARD'}.`;

      case 'AllocationRecalculated':
      case 'AllocationChanged':
        return `Schedule reallocated: ${p.allocationsCount || p.allocations?.length || 'multiple'} dynamic time blocks updated.`;

      case 'ActivityScheduled':
        return `Blueprint scheduled for subject: ${subject}.`;

      case 'ActivityStarted':
        return `Activity '${subject}' execution started.`;

      case 'ActivityPaused':
        return `Activity '${subject}' paused. Reason: ${p.reason || 'User initiated'}.`;

      case 'ActivityResumed':
        return `Activity '${subject}' resumed.`;

      case 'ActivityCompleted':
        return `Activity '${subject}' completed with status: ${p.executionStatus || 'ON_TIME'}.`;

      case 'ActivityAdjusted':
        return `Activity '${subject}' time bounds adjusted to ${p.startMinutes}m - ${p.endMinutes}m.`;

      case 'DeviationDetected':
        return `Deviation detected: [${p.type || 'DRIFT'}] for ${subject} (${p.description || p.reason || 'time drift'}).`;

      case 'FallbackEvaluated':
      case 'FallbackSelected':
      case 'FallbackTriggered':
        return `Fallback tier ${p.tierLevel || p.fallbackLevel || 1} triggered for '${subject}': ${p.action || p.fallbackDescription || 'compressed scope'}.`;

      case 'TradingGateEvaluated':
      case 'TradingAuthorized':
      case 'TradingBlocked':
        return p.authorized
          ? `Trading session authorized: all prerequisites (market analysis & setup verification) satisfied.`
          : `Trading session blocked: gate closed (${p.reason || 'prerequisites incomplete'}).`;

      case 'OverrideRequested':
      case 'OverrideGranted':
      case 'OverrideDenied':
      case 'OverrideCreated':
        return `User override [${p.overrideType || 'ADJUST'}] ${event.event_type.includes('Denied') ? 'denied' : 'applied'} for '${subject}'.`;

      case 'AdaptationProposalCreated':
      case 'AdaptationApplied':
        return `Adaptation proposal ${event.event_type.includes('Applied') ? 'applied' : 'generated'}: ${p.title || p.description || 'optimization'}.`;

      default:
        return event.metadata.rationale || `Executed domain event: ${event.event_type} on ${subject}.`;
    }
  }

  private deriveWhy(event: SystemEvent, causalAncestry: SystemEvent[]): string {
    if (event.metadata.rationale) return event.metadata.rationale;
    if (event.payload?.reason) return event.payload.reason;
    if (event.payload?.description) return event.payload.description;

    // Check ancestors for rationale
    for (let i = causalAncestry.length - 1; i >= 0; i--) {
      const anc = causalAncestry[i];
      if (anc.metadata.rationale) return `Derived from ancestor [${anc.event_type}]: ${anc.metadata.rationale}`;
      if (anc.payload?.reason) return `Derived from ancestor [${anc.event_type}]: ${anc.payload.reason}`;
    }

    return 'Autonomous optimization governed by standard daily operating constraints.';
  }

  private deriveEngine(event: SystemEvent): string {
    if (event.metadata.engine) return event.metadata.engine;

    switch (event.event_type) {
      case 'RoutineStateTransitioned':
      case 'RoutineActivated':
      case 'RoutineChanged':
        return 'RoutineEngine';

      case 'AllocationRecalculated':
      case 'AllocationChanged':
      case 'AllocationCreated':
      case 'AllocationPlanCommitted':
        return 'AllocationEngine';

      case 'DeviationDetected':
      case 'InterventionTriggered':
        return 'DeviationEngine';

      case 'FallbackEvaluated':
      case 'FallbackSelected':
      case 'FallbackTriggered':
      case 'FallbackCompleted':
        return 'FallbackEngine';

      case 'TradingGateEvaluated':
      case 'TradingAuthorized':
      case 'TradingBlocked':
      case 'DependencyChecked':
      case 'DependencySatisfied':
      case 'DependencyBroken':
        return 'DependencyEngine';

      case 'DecisionRequested':
      case 'DecisionSelected':
      case 'HumanDecisionRequested':
      case 'HumanDecisionReceived':
      case 'DecisionApproved':
      case 'DecisionRejected':
        return 'DecisionEngine';

      case 'AdaptationPatternDetected':
      case 'AdaptationProposalCreated':
      case 'AdaptationApproved':
      case 'AdaptationApplied':
        return 'AdaptationEngine';

      case 'OverrideRequested':
      case 'OverrideEvaluated':
      case 'OverrideGranted':
      case 'OverrideDenied':
      case 'OverrideCreated':
        return 'GovernanceEngine';

      default:
        return 'DayExecutionKernel';
    }
  }

  private derivePolicy(event: SystemEvent): string {
    if (event.metadata.policy) return event.metadata.policy;

    switch (event.event_type) {
      case 'TradingGateEvaluated':
      case 'TradingAuthorized':
      case 'TradingBlocked':
        return 'TradingGatekeeperPrerequisitesPolicy';

      case 'AllocationRecalculated':
      case 'AllocationChanged':
        return 'ProtectedFamilySanctuaryAndEnergyPolicy';

      case 'RoutineStateTransitioned':
        return 'LateWakeRecoveryAndCompressionPolicy';

      case 'FallbackEvaluated':
      case 'FallbackSelected':
      case 'FallbackTriggered':
        return 'MinimumEffectiveDoseFallbackPolicy';

      case 'OverrideGranted':
      case 'OverrideEvaluated':
        return 'HumanAutonomyAndOverrideGovernancePolicy';

      case 'AdaptationProposalCreated':
      case 'AdaptationApplied':
        return 'ContinuousExecutionOptimizationPolicy';

      default:
        return 'StandardOperatingExecutionPolicy';
    }
  }

  private deriveStateChanged(event: SystemEvent): { summary: string; diff: any } {
    if (event.metadata.stateDiff) {
      return {
        summary: `State delta recorded with ${Object.keys(event.metadata.stateDiff).length} property changes.`,
        diff: event.metadata.stateDiff,
      };
    }

    const p = event.payload || {};
    const diff: Record<string, any> = {};

    if (p.routineState) diff.routineState = { after: p.routineState };
    if (p.mode) diff.mode = { after: p.mode };
    if (p.executionStatus) diff.executionStatus = { after: p.executionStatus };
    if (p.allocations) diff.allocationsCount = { count: p.allocations.length };
    if (p.taskId) diff.taskId = p.taskId;

    return {
      summary: Object.keys(diff).length > 0 ? `Updated properties: ${Object.keys(diff).join(', ')}` : 'Domain record logged without breaking schema shifts.',
      diff: Object.keys(diff).length > 0 ? diff : p,
    };
  }

  /**
   * Returns causation tree rooted at or leading to target event.
   */
  async getCausalTree(eventId: string): Promise<CausalNode | null> {
    const event = await this.eventStore.getEventById(eventId);
    if (!event) return null;

    const childEvents = await this.eventStore.getEventsByCausationId(eventId);
    const childrenNodes: CausalNode[] = [];

    for (const child of childEvents) {
      const subtree = await this.getCausalTree(child.event_id);
      if (subtree) childrenNodes.push(subtree);
    }

    return {
      eventId: event.event_id,
      eventType: event.event_type,
      occurredAt: event.occurred_at,
      actor: typeof event.actor === 'string' ? event.actor : event.actor.name || event.actor.type,
      summary: this.deriveWhatHappened(event),
      causationId: event.causation_id,
      children: childrenNodes,
    };
  }
}

export const defaultExecutionAuditService = new ExecutionAuditService();
