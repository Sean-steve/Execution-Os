import { SystemEvent, AppState, RoutineState, SystemMode } from '../types';
import { createSystemEvent } from './eventBus';
import { IClock, TestClock } from '../clock';

export interface EventChainResult {
  chainName: string;
  correlationId: string;
  events: SystemEvent[];
}

export class ExecutionEventChainService {
  private clock: IClock;

  constructor(clock: IClock = new TestClock('05:30')) {
    this.clock = clock;
  }

  /**
   * 1. LATE WAKE EVENT CHAIN
   * WakeupLogged / WakeDeviationDetected -> RoutineStateTransitioned (COMPRESSED) -> AllocationRecalculated
   */
  createLateWakeChain(wakeTime: string = '06:35', state: Partial<AppState> = {}): EventChainResult {
    const correlationId = `corr-late-wake-${Date.now()}`;
    const wakeMinutes = 395; // 06:35 = 395 mins (65 mins drift from 05:30)

    // Event 1: Deviation Detected (Late wake)
    const evt1 = createSystemEvent(
      'DeviationDetected',
      {
        subject: 'WAKE_WINDOW_ANCHOR',
        correlationId,
        engine: 'DeviationEngine',
        policy: 'LateWakeRecoveryAndCompressionPolicy',
        rationale: `Actual wake time (${wakeTime}) drifted 65 minutes past target (05:30).`,
        stateDiff: {
          simulatedTime: { before: '05:30', after: wakeTime },
          wakeDriftMinutes: { before: 0, after: 65 },
        },
      },
      {
        type: 'LATE',
        driftMinutes: 65,
        targetTime: '05:30',
        actualTime: wakeTime,
      },
      state,
      'SYSTEM_KERNEL',
      undefined,
      this.clock
    );

    // Event 2: Routine Transition (STANDARD -> COMPRESSED) caused by Evt 1
    const evt2 = createSystemEvent(
      'RoutineStateTransitioned',
      {
        subject: 'DAY_ROUTINE_AGGREGATE',
        correlationId,
        causationId: evt1.event_id,
        engine: 'RoutineEngine',
        policy: 'LateWakeRecoveryAndCompressionPolicy',
        rationale: 'Late wake beyond 45-minute threshold automatically initiates routine compression protocol.',
        stateDiff: {
          routineState: { before: 'STANDARD', after: 'COMPRESSED' },
        },
      },
      {
        previousRoutineState: 'STANDARD',
        routineState: 'COMPRESSED',
        reason: 'Late wake recovery protocol',
      },
      { ...state, routineState: 'COMPRESSED' },
      'SYSTEM_KERNEL',
      evt1.event_id,
      this.clock
    );

    // Event 3: Dynamic Allocations Recalculated caused by Evt 2
    const evt3 = createSystemEvent(
      'AllocationRecalculated',
      {
        subject: 'DAY_ALLOCATIONS_LEDGER',
        correlationId,
        causationId: evt2.event_id,
        engine: 'AllocationEngine',
        policy: 'AuthoritativeProtectedCommitmentPolicy',
        rationale: 'Recomputed flexible execution while preserving authoritative protected commitments.',
        stateDiff: {
          compressedTasksCount: { before: 0, after: 3 },
          protectedCommitmentOverlap: { before: false, after: false },
        },
      },
      {
        routineState: 'COMPRESSED',
        allocationsCount: 12,
        protectedCommitmentsPreserved: true,
      },
      { ...state, routineState: 'COMPRESSED' },
      'SYSTEM_KERNEL',
      evt2.event_id,
      this.clock
    );

    return {
      chainName: 'Late Wake',
      correlationId,
      events: [evt1, evt2, evt3],
    };
  }

  /**
   * 2. MISSED ACTIVITY EVENT CHAIN
   * ActivityWindowMissed -> DeviationDetected -> DisciplinePenaltyRecorded
   */
  createMissedActivityChain(taskId: string = 'task-cardio', taskTitle: string = 'Zone 2 Cardio Workout'): EventChainResult {
    const correlationId = `corr-missed-act-${Date.now()}`;

    // Event 1: Activity Window Missed
    const evt1 = createSystemEvent(
      'ActivityMissed',
      {
        subject: { type: 'activity', id: taskId, title: taskTitle },
        correlationId,
        engine: 'DayExecutionKernel',
        policy: 'NeverMissTwiceDisciplinePolicy',
        rationale: `Scheduled window for '${taskTitle}' elapsed without execution.`,
        stateDiff: {
          executionStatus: { before: 'PENDING', after: 'MISSED_LATE' },
        },
      },
      { taskId, scheduledWindow: '06:30 - 07:15' },
      {},
      'SYSTEM_KERNEL',
      undefined,
      this.clock
    );

    // Event 2: Deviation Recorded caused by Evt 1
    const evt2 = createSystemEvent(
      'DeviationDetected',
      {
        subject: { type: 'activity', id: taskId, title: taskTitle },
        correlationId,
        causationId: evt1.event_id,
        engine: 'DeviationEngine',
        policy: 'NeverMissTwiceDisciplinePolicy',
        rationale: 'Recorded missed activity deviation and checked Never Miss Twice streak guard.',
        stateDiff: {
          deviationsCount: { before: 0, after: 1 },
        },
      },
      { taskId, deviationType: 'MISSED', penaltyCutPoints: 10 },
      {},
      'SYSTEM_KERNEL',
      evt1.event_id,
      this.clock
    );

    // Event 3: Discipline Penalty Recorded caused by Evt 2
    const evt3 = createSystemEvent(
      'DisciplinePenaltyRecorded',
      {
        subject: { type: 'activity', id: taskId, title: taskTitle },
        correlationId,
        causationId: evt2.event_id,
        engine: 'GovernanceEngine',
        policy: 'NeverMissTwiceDisciplinePolicy',
        rationale: 'Discipline points deducted to hold operator accountable to baseline standards.',
        stateDiff: {
          disciplinePenaltiesCount: { before: 0, after: 1 },
          pointsDeducted: 10,
        },
      },
      { taskId, pointsDeducted: 10, penaltyReason: 'Missed scheduled exercise window' },
      {},
      'GOVERNANCE_GUARD',
      evt2.event_id,
      this.clock
    );

    return {
      chainName: 'Missed Activity',
      correlationId,
      events: [evt1, evt2, evt3],
    };
  }

  /**
   * 3. FALLBACK EVENT CHAIN
   * FallbackEvaluated -> FallbackSelected (Tier 1/2) -> AllocationChanged -> FallbackCompleted
   */
  createFallbackChain(taskId: string = 'task-meditation', taskTitle: string = 'Mindset & Meditation'): EventChainResult {
    const correlationId = `corr-fallback-${Date.now()}`;

    // Event 1: Fallback Evaluated
    const evt1 = createSystemEvent(
      'FallbackEvaluated',
      {
        subject: { type: 'activity', id: taskId, title: taskTitle },
        correlationId,
        engine: 'FallbackEngine',
        policy: 'MinimumEffectiveDoseFallbackPolicy',
        rationale: 'Time pressure requires reducing standard 20m meditation to Minimum Effective Dose (5m box breathing).',
      },
      { taskId, originalDurationMinutes: 20, candidateTiers: [1, 2] },
      {},
      'SYSTEM_KERNEL',
      undefined,
      this.clock
    );

    // Event 2: Fallback Selected caused by Evt 1
    const evt2 = createSystemEvent(
      'FallbackSelected',
      {
        subject: { type: 'activity', id: taskId, title: taskTitle },
        correlationId,
        causationId: evt1.event_id,
        engine: 'FallbackEngine',
        policy: 'MinimumEffectiveDoseFallbackPolicy',
        rationale: 'Selected Tier 1 Fallback (5m box breathing) preserving core neural reset.',
        stateDiff: {
          fallbackLevel: { before: 0, after: 1 },
          durationMinutes: { before: 20, after: 5 },
        },
      },
      { taskId, selectedTier: 1, fallbackAction: '5-minute Box Breathing protocol' },
      {},
      'SYSTEM_KERNEL',
      evt1.event_id,
      this.clock
    );

    // Event 3: Allocation Changed caused by Evt 2
    const evt3 = createSystemEvent(
      'AllocationChanged',
      {
        subject: { type: 'activity', id: taskId, title: taskTitle },
        correlationId,
        causationId: evt2.event_id,
        engine: 'AllocationEngine',
        policy: 'MinimumEffectiveDoseFallbackPolicy',
        rationale: 'Allocation contracted to 5 minutes to release 15 minutes to subsequent deep work.',
        stateDiff: {
          allocatedDuration: { before: 20, after: 5 },
        },
      },
      { taskId, allocatedStartMinutes: 360, allocatedEndMinutes: 365 },
      {},
      'SYSTEM_KERNEL',
      evt2.event_id,
      this.clock
    );

    // Event 4: Fallback Completed caused by Evt 3
    const evt4 = createSystemEvent(
      'FallbackCompleted',
      {
        subject: { type: 'activity', id: taskId, title: taskTitle },
        correlationId,
        causationId: evt3.event_id,
        engine: 'DayExecutionKernel',
        policy: 'MinimumEffectiveDoseFallbackPolicy',
        rationale: 'Executed 5m fallback with 100% adherence and full reset efficacy.',
        stateDiff: {
          executionStatus: { before: 'ACTIVE', after: 'FALLBACK_EXECUTED' },
          completed: { before: false, after: true },
        },
      },
      { taskId, executionStatus: 'FALLBACK_EXECUTED', completionPercentage: 100 },
      {},
      'SYSTEM_KERNEL',
      evt3.event_id,
      this.clock
    );

    return {
      chainName: 'Fallback',
      correlationId,
      events: [evt1, evt2, evt3, evt4],
    };
  }

  /**
   * 4. REALLOCATION EVENT CHAIN
   * ReallocationRequested -> ConstraintEvaluated (Family block safe) -> AllocationPlanCommitted
   */
  createReallocationChain(): EventChainResult {
    const correlationId = `corr-realloc-${Date.now()}`;

    // Event 1: Allocation Changed
    const evt1 = createSystemEvent(
      'AllocationChanged',
      {
        subject: 'DAY_ALLOCATIONS_LEDGER',
        correlationId,
        engine: 'AllocationEngine',
        policy: 'ProtectedFamilySanctuaryAndEnergyPolicy',
        rationale: 'Dynamic reallocation initiated to accommodate deep work sprint adjustment.',
      },
      { reason: 'Deep work sprint adjustment' },
      {},
      'SYSTEM_KERNEL',
      undefined,
      this.clock
    );

    // Event 2: Allocation Plan Committed caused by Evt 1
    const evt2 = createSystemEvent(
      'AllocationPlanCommitted',
      {
        subject: 'DAY_ALLOCATIONS_LEDGER',
        correlationId,
        causationId: evt1.event_id,
        engine: 'AllocationEngine',
        policy: 'ProtectedFamilySanctuaryAndEnergyPolicy',
        rationale: 'Committed non-overlapping schedule guaranteeing 16:00 - 19:30 Protected Family sanctuary is 100% untouched.',
        stateDiff: {
          isFeasible: { before: false, after: true },
          totalAllocations: { before: 10, after: 12 },
        },
      },
      { allocationsCount: 12, protectedFamilySafe: true },
      {},
      'SYSTEM_KERNEL',
      evt1.event_id,
      this.clock
    );

    return {
      chainName: 'Reallocation',
      correlationId,
      events: [evt1, evt2],
    };
  }

  /**
   * 5. EXTERNAL EXECUTION GATE EVENT CHAIN
   * External domain state -> generic gate update -> execution eligibility.
   */
  createExternalGateEligibilityChain(
    sourceEngine: string = 'EXTERNAL_DOMAIN',
    targetActivityId: string = 'external-action',
    isAuthorized: boolean = true
  ): EventChainResult {
    const correlationId = `corr-external-gate-${Date.now()}`;

    const evt1 = createSystemEvent(
      'DependencySatisfied',
      {
        subject: { type: 'dependency', id: `dep-${targetActivityId}`, title: 'External Domain Prerequisite' },
        correlationId,
        engine: 'DependencyEngine',
        policy: 'ExternalExecutionGateContract',
        rationale: 'Owning domain supplied prerequisite evidence to the execution boundary.',
      },
      { sourceEngine, targetActivityId, prerequisiteEvidenceAvailable: true },
      {},
      'SYSTEM_KERNEL',
      undefined,
      this.clock
    );

    const evt2 = createSystemEvent(
      'ExternalExecutionGateUpdated',
      {
        subject: { type: 'gate', id: `gate-${targetActivityId}`, title: 'External Execution Gate' },
        correlationId,
        causationId: evt1.event_id,
        engine: 'ExternalExecutionGateAdapter',
        policy: 'ExternalExecutionGateContract',
        rationale: isAuthorized
          ? 'Owning domain authorized bounded execution.'
          : 'Owning domain has not authorized execution.',
        stateDiff: {
          gateStatus: { before: 'BLOCKED', after: isAuthorized ? 'OPEN' : 'BLOCKED' },
        },
      },
      {
        sourceEngine,
        targetActivityId,
        status: isAuthorized ? 'OPEN' : 'BLOCKED',
      },
      {},
      'GOVERNANCE_GUARD',
      evt1.event_id,
      this.clock
    );

    const evt3 = createSystemEvent(
      'ExternalExecutionGateUpdated',
      {
        subject: { type: 'activity', id: targetActivityId, title: 'Bounded External Action' },
        correlationId,
        causationId: evt2.event_id,
        engine: 'ExecutionBoundary',
        policy: 'ExternalExecutionGateContract',
        rationale: isAuthorized
          ? 'Execution boundary confirmed the external authorization.'
          : 'Execution boundary preserved the external-domain block.',
      },
      { sourceEngine, targetActivityId, executionEligible: isAuthorized },
      {},
      'GOVERNANCE_GUARD',
      evt2.event_id,
      this.clock
    );

    return {
      chainName: 'External Gate Eligibility',
      correlationId,
      events: [evt1, evt2, evt3],
    };
  }

  /**
   * @deprecated Legacy standalone compatibility only. Trading policy belongs to its owning domain.
   */
  createTradingEligibilityChain(isAuthorized: boolean = true): EventChainResult {
    return this.createExternalGateEligibilityChain(
      'LEGACY_TRADING_COMPATIBILITY_ADAPTER',
      'task-trading-execution',
      isAuthorized
    );
  }

  /**
   * 6. HUMAN OVERRIDE EVENT CHAIN
   * OverrideRequested -> OverrideEvaluated -> OverrideGranted -> ScheduleUpdated
   */
  createHumanOverrideChain(taskId: string = 'task-deep-work-build', reason: string = 'Critical production release'): EventChainResult {
    const correlationId = `corr-override-${Date.now()}`;

    // Event 1: Override Requested by User
    const evt1 = createSystemEvent(
      'OverrideRequested',
      {
        subject: { type: 'activity', id: taskId, title: 'Deep Work Sprint' },
        correlationId,
        actor: 'USER',
        engine: 'GovernanceEngine',
        policy: 'HumanAutonomyAndOverrideGovernancePolicy',
        rationale: `User requested emergency override: ${reason}`,
      },
      { taskId, overrideType: 'ADJUST', reason, requestedStart: 720, requestedEnd: 840 },
      {},
      'USER',
      undefined,
      this.clock
    );

    // Event 2: Override Evaluated by Governance caused by Evt 1
    const evt2 = createSystemEvent(
      'OverrideEvaluated',
      {
        subject: { type: 'activity', id: taskId, title: 'Deep Work Sprint' },
        correlationId,
        causationId: evt1.event_id,
        engine: 'GovernanceEngine',
        policy: 'HumanAutonomyAndOverrideGovernancePolicy',
        rationale: 'Governance evaluated the override against authoritative protected commitments and confirmed the requested execution window remains within permitted boundaries.',
        stateDiff: {
          overrideAllowed: { before: false, after: true },
        },
      },
      { allowed: true, safetyCheckPassed: true },
      {},
      'GOVERNANCE_GUARD',
      evt1.event_id,
      this.clock
    );

    // Event 3: Override Granted & Schedule Updated caused by Evt 2
    const evt3 = createSystemEvent(
      'OverrideGranted',
      {
        subject: { type: 'activity', id: taskId, title: 'Deep Work Sprint' },
        correlationId,
        causationId: evt2.event_id,
        engine: 'GovernanceEngine',
        policy: 'HumanAutonomyAndOverrideGovernancePolicy',
        rationale: 'User override authorized and recorded in permanent governance ledger.',
        stateDiff: {
          startMinutes: { before: 780, after: 720 },
          endMinutes: { before: 900, after: 840 },
        },
      },
      { taskId, overrideType: 'ADJUST', applied: true },
      {},
      'GOVERNANCE_GUARD',
      evt2.event_id,
      this.clock
    );

    return {
      chainName: 'Human Override',
      correlationId,
      events: [evt1, evt2, evt3],
    };
  }

  /**
   * 7. ADAPTATION PROPOSAL EVENT CHAIN
   * AdaptationPatternDetected -> AdaptationProposalCreated -> AdaptationApproved -> AdaptationApplied
   */
  createAdaptationProposalChain(): EventChainResult {
    const correlationId = `corr-adaptation-${Date.now()}`;

    // Event 1: Pattern Detected
    const evt1 = createSystemEvent(
      'AdaptationPatternDetected',
      {
        subject: { type: 'pattern', id: 'pat-afternoon-energy-dip', title: 'Afternoon Energy Dip' },
        correlationId,
        engine: 'AdaptationEngine',
        policy: 'ContinuousExecutionOptimizationPolicy',
        rationale: 'System identified 4 occurrences of attention drift between 14:00 - 15:00.',
      },
      { frequency: 4, confidenceScore: 0.85 },
      {},
      'SYSTEM_KERNEL',
      undefined,
      this.clock
    );

    // Event 2: Proposal Created caused by Evt 1
    const evt2 = createSystemEvent(
      'AdaptationProposalCreated',
      {
        subject: { type: 'proposal', id: 'prop-afternoon-buffer', title: 'Insert 15m Afternoon Buffer' },
        correlationId,
        causationId: evt1.event_id,
        engine: 'AdaptationEngine',
        policy: 'ContinuousExecutionOptimizationPolicy',
        rationale: 'Proposed inserting a 15-minute physical walk buffer before second deep work block to restore cognitive energy.',
      },
      { proposalId: 'prop-afternoon-buffer', impactLevel: 'LOW_RISK_AUTO' },
      {},
      'SYSTEM_KERNEL',
      evt1.event_id,
      this.clock
    );

    // Event 3: Proposal Approved caused by Evt 2
    const evt3 = createSystemEvent(
      'AdaptationApproved',
      {
        subject: { type: 'proposal', id: 'prop-afternoon-buffer', title: 'Insert 15m Afternoon Buffer' },
        correlationId,
        causationId: evt2.event_id,
        engine: 'DecisionEngine',
        policy: 'ContinuousExecutionOptimizationPolicy',
        rationale: 'Approved adaptation proposal based on low-risk classification.',
      },
      { proposalId: 'prop-afternoon-buffer', approvedBy: 'AUTONOMOUS_KERNEL' },
      {},
      'SYSTEM_KERNEL',
      evt2.event_id,
      this.clock
    );

    // Event 4: Proposal Applied caused by Evt 3
    const evt4 = createSystemEvent(
      'AdaptationApplied',
      {
        subject: { type: 'proposal', id: 'prop-afternoon-buffer', title: 'Insert 15m Afternoon Buffer' },
        correlationId,
        causationId: evt3.event_id,
        engine: 'AdaptationEngine',
        policy: 'ContinuousExecutionOptimizationPolicy',
        rationale: 'Applied 15m afternoon buffer to standard daily activity blueprint.',
        stateDiff: {
          afternoonBufferActive: { before: false, after: true },
        },
      },
      { proposalId: 'prop-afternoon-buffer', appliedAtMinutes: 840 },
      {},
      'SYSTEM_KERNEL',
      evt3.event_id,
      this.clock
    );

    return {
      chainName: 'Adaptation Proposal',
      correlationId,
      events: [evt1, evt2, evt3, evt4],
    };
  }

  /**
   * 8. ROUTINE CHANGE EVENT CHAIN
   * SystemModeChanged (to RED) -> RoutineStateTransitioned (RECOVERY_ONLY) -> ScheduleRecalculated
   */
  createRoutineChangeChain(targetMode: SystemMode = 'RED'): EventChainResult {
    const correlationId = `corr-routine-change-${Date.now()}`;

    // Event 1: Mode Change Requested / Applied
    const evt1 = createSystemEvent(
      'RoutineChanged',
      {
        subject: 'SYSTEM_MODE',
        correlationId,
        engine: 'RoutineEngine',
        policy: 'EnergyStateAlignmentPolicy',
        rationale: `System mode changed to ${targetMode} due to low physiological energy/illness.`,
        stateDiff: {
          currentMode: { before: 'GREEN', after: targetMode },
        },
      },
      { mode: targetMode, reason: 'Low biological energy' },
      { currentMode: targetMode },
      'USER',
      undefined,
      this.clock
    );

    // Event 2: Routine State Transitioned caused by Evt 1
    const evt2 = createSystemEvent(
      'RoutineStateTransitioned',
      {
        subject: 'DAY_ROUTINE_AGGREGATE',
        correlationId,
        causationId: evt1.event_id,
        engine: 'RoutineEngine',
        policy: 'EnergyStateAlignmentPolicy',
        rationale: 'RED mode automatically collapses schedule into RECOVERY, stripping all cognitive overload.',
        stateDiff: {
          routineState: { before: 'STANDARD', after: 'RECOVERY' },
        },
      },
      { previousState: 'STANDARD', routineState: 'RECOVERY' },
      { currentMode: targetMode, routineState: 'RECOVERY' },
      'SYSTEM_KERNEL',
      evt1.event_id,
      this.clock
    );

    // Event 3: Allocation Recalculated caused by Evt 2
    const evt3 = createSystemEvent(
      'AllocationRecalculated',
      {
        subject: 'DAY_ALLOCATIONS_LEDGER',
        correlationId,
        causationId: evt2.event_id,
        engine: 'AllocationEngine',
        policy: 'EnergyStateAlignmentPolicy',
        rationale: 'Removed heavy build sprints and trading sessions; allocated gentle walks, hydration, and sleep.',
        stateDiff: {
          activeTasksCount: { before: 12, after: 4 },
        },
      },
      { routineState: 'RECOVERY', activeTasks: ['hydration', 'rest', 'walk', 'sleep'] },
      { currentMode: targetMode, routineState: 'RECOVERY' },
      'SYSTEM_KERNEL',
      evt2.event_id,
      this.clock
    );

    return {
      chainName: 'Routine Change',
      correlationId,
      events: [evt1, evt2, evt3],
    };
  }

  /**
   * 9. TOMORROW ACTIVATION EVENT CHAIN
   * PlanTomorrowSubmitted -> ActivityScheduled -> RoutineActivated -> ScheduleAllocated
   */
  createTomorrowActivationChain(scheduleFocus: string = 'Heavy Builder Sprint'): EventChainResult {
    const correlationId = `corr-tomorrow-plan-${Date.now()}`;

    // Event 1: Night-Before Plan Scheduled
    const evt1 = createSystemEvent(
      'ActivityScheduled',
      {
        subject: 'TOMORROW_PLAN_BLUEPRINT',
        correlationId,
        actor: 'USER',
        engine: 'CommandPipeline',
        policy: 'NightBeforeIntentionalityPolicy',
        rationale: `Night-before execution blueprint locked: Focus '${scheduleFocus}'.`,
        stateDiff: {
          tomorrowPlanFocus: { before: '', after: scheduleFocus },
        },
      },
      {
        scheduleFocus,
        top3: ['Build Execution OS API', 'Company Outreach Sprint', 'Family Evening Walk'],
      },
      {},
      'USER',
      undefined,
      this.clock
    );

    // Event 2: Day Execution Activated caused by Evt 1
    const evt2 = createSystemEvent(
      'RoutineActivated',
      {
        subject: 'DAY_EXECUTION_KERNEL',
        correlationId,
        causationId: evt1.event_id,
        engine: 'RoutineEngine',
        policy: 'StandardOperatingExecutionPolicy',
        rationale: 'Morning 05:30 kernel ignition activating standard daily ledger.',
        stateDiff: {
          routineState: { before: 'UNINITIALIZED', after: 'STANDARD' },
          dayActive: { before: false, after: true },
        },
      },
      { mode: 'GREEN', dayType: 'STANDARD' },
      { currentMode: 'GREEN', dayType: 'STANDARD', routineState: 'STANDARD' },
      'SYSTEM_KERNEL',
      evt1.event_id,
      this.clock
    );

    // Event 3: Allocations Committed caused by Evt 2
    const evt3 = createSystemEvent(
      'AllocationPlanCommitted',
      {
        subject: 'DAY_ALLOCATIONS_LEDGER',
        correlationId,
        causationId: evt2.event_id,
        engine: 'AllocationEngine',
        policy: 'ProtectedFamilySanctuaryAndEnergyPolicy',
        rationale: 'Locked in pristine daily time windows with Protected Family Block.',
      },
      { allocationsCount: 14, isFeasible: true },
      { currentMode: 'GREEN', dayType: 'STANDARD', routineState: 'STANDARD' },
      'SYSTEM_KERNEL',
      evt2.event_id,
      this.clock
    );

    return {
      chainName: 'Tomorrow Activation',
      correlationId,
      events: [evt1, evt2, evt3],
    };
  }
}

export const defaultEventChainService = new ExecutionEventChainService();
