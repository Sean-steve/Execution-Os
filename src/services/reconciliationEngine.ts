import {
  AppState,
  SystemEvent,
  LifecycleReconciliationResult,
  ExecutionNotification,
  DayHistoryRecord,
  RoutineTask,
  DeviationRecord,
  BackgroundJobRecord
} from '../types';
import { IClock, getClockForState, formatMinutesTo12Hour } from '../clock';
import { createSystemEvent } from './eventBus';
import { calculate7Pillars } from './storageService';
import { activateTomorrowIntent, executeLateWakeRecovery, evaluateTomorrowFeasibility } from './tomorrowPlanningEngine';
import { calculateDynamicAllocations, PROTECTED_FAMILY_START } from './allocationEngine';
import { evaluateRoutineState } from './routineEngine';
import { getAutonomousNextDecision } from './decisionEngine';
import { defaultExecutionAuditService } from './executionAuditService';
import { defaultDurableEventStore } from './durableEventStore';

export interface ReconciliationOptions {
  forceDayBoundary?: boolean;
  triggerOrigin?: 'BACKGROUND_WORKER' | 'CLIENT_HYDRATION' | 'MANUAL_TRIGGER' | 'OFFLINE_RECOVERY';
  targetMinutes?: number;
  dryRun?: boolean;
}

/**
 * Deterministic Lifecycle Reconciliation Engine (EOS-014)
 * 
 * Reconciles day boundaries, tomorrow activation, wake drift recovery, expired allocations,
 * and background jobs deterministically across online/offline cycles.
 */
export function reconcileLifecycleState(
  inputState: AppState,
  clock?: IClock,
  options: ReconciliationOptions = {}
): {
  state: AppState;
  result: LifecycleReconciliationResult;
  events: SystemEvent[];
} {
  // Deep clone state to ensure pure deterministic transformation
  const state: AppState = JSON.parse(JSON.stringify(inputState));
  const activeClock = clock || getClockForState(state);
  const nowIso = activeClock.toISOString();
  const currentDate = nowIso.split('T')[0];
  const currentMinutes = options.targetMinutes !== undefined 
    ? options.targetMinutes 
    : activeClock.getCurrentTimeMinutes();

  const prevActiveDate = state.activeDate || currentDate;
  const events: SystemEvent[] = [];
  const notifications: ExecutionNotification[] = state.notifications ? [...state.notifications] : [];

  let dayBoundaryCrossed = false;
  let dayActivated = false;
  let lateWakeDetected = false;
  let lateWakeDriftMinutes = 0;
  const expiredTasksMarked: string[] = [];
  const missedAnchorsHandled: string[] = [];
  let expiredAllocationsCount = 0;
  let decisionsGenerated = 0;
  let notificationsGenerated = 0;
  let adaptationsTriggered = 0;

  // Initialize scheduler state if missing
  if (!state.scheduler) {
    state.scheduler = {
      enabled: true,
      isRunning: true,
      mode: 'ACTIVE',
      lastTickAt: null,
      nextScheduledTickAt: null,
      tickIntervalMs: 30000,
      timezone: state.timezone || 'UTC',
      jobs: [],
      lastReconciliation: null,
      totalJobsExecuted: 0,
      successfulJobsCount: 0,
      failedJobsCount: 0,
    };
  }

  // -------------------------------------------------------------------------
  // 1. DAY BOUNDARY TRANSITION & AUTONOMOUS DAY ACTIVATION
  // -------------------------------------------------------------------------
  const isDateChange = currentDate !== prevActiveDate;
  if (isDateChange || options.forceDayBoundary) {
    dayBoundaryCrossed = true;

    // A. Archive Yesterday's State to History (if not already archived for prevActiveDate)
    const alreadyArchived = (state.history || []).some(h => h.date === prevActiveDate);
    if (!alreadyArchived) {
      const pillarsEval = calculate7Pillars(state);
      const topVictory = state.victoryQuestionAnswer || state.dailyReview?.winsAndVictories || 'Maintained continuous operational discipline';

      const historyRecord: DayHistoryRecord = {
        date: prevActiveDate,
        score: pillarsEval.score,
        mode: state.currentMode,
        dayType: state.dayType,
        pillars: {
          morning: pillarsEval.pillars.find(p => p.key === 'morning')?.satisfied || false,
          body: pillarsEval.pillars.find(p => p.key === 'body')?.satisfied || false,
          mission: pillarsEval.pillars.find(p => p.key === 'mission')?.satisfied || false,
          business: pillarsEval.pillars.find(p => p.key === 'business')?.satisfied || false,
          wealthTrading: pillarsEval.pillars.find(p => p.key === 'wealthTrading')?.satisfied || false,
          family: pillarsEval.pillars.find(p => p.key === 'family')?.satisfied || false,
          eveningShutdown: pillarsEval.pillars.find(p => p.key === 'eveningShutdown')?.satisfied || false,
        },
        topVictory,
        reflectionSummary: state.dailyReview?.eveningReflection || 'Autonomously archived upon day boundary transition.',
      };

      state.history = [historyRecord, ...(state.history || [])];
    }

    // B. Promote Tomorrow Plan & Activate Today
    const activation = activateTomorrowIntent(state, {}, activeClock);
    Object.assign(state, activation.state);
    events.push(...activation.events);
    dayActivated = true;

    // Reset daily counters
    state.morningWorkoutSetsDone = 0;
    state.afternoonWorkoutSetsDone = 0;
    state.morningOutdoorMinutes = 0;
    state.meditationMinutes = 0;
    state.pointsAwardedTasks = [];
    state.disciplinePenaltiesCount = 0;
    state.activeDate = currentDate;
    state.identityStatus = {
      rememberedDream: false,
      rememberedWho: false,
      rememberedWhere: false,
      rememberedWhatBuilding: false,
      completedToday: false,
    };

    // Day Boundary & Activation Events
    const boundaryEvt = createSystemEvent(
      'DayBoundaryCrossed',
      'system',
      {
        previousDate: prevActiveDate,
        newDate: currentDate,
        archivedScore: state.history[0]?.score || 0,
        triggerOrigin: options.triggerOrigin || 'BACKGROUND_WORKER',
      },
      state,
      'SYSTEM_KERNEL',
      undefined,
      activeClock
    );
    events.push(boundaryEvt);

    // Day Activation Notification
    const notifId = `notif-activation-${currentDate}`;
    if (!notifications.some(n => n.id === notifId)) {
      notifications.unshift({
        id: notifId,
        timestamp: nowIso,
        type: 'DAY_ACTIVATION',
        title: `Day Activated: ${currentDate}`,
        message: `Execution OS established daily baseline. ${state.tasks.length} anchors instantiated under ${state.currentMode} Mode.`,
        priority: 'HIGH',
        read: false,
        metadata: { date: currentDate, mode: state.currentMode },
      });
      notificationsGenerated++;
    }
  }

  // -------------------------------------------------------------------------
  // 2. SCHEDULED WAKE & LATE WAKE RECOVERY (OFFLINE CATCH-UP)
  // -------------------------------------------------------------------------
  const plannedWake = state.tomorrowPlan?.desiredWakeMinutes || 330; // 5:30 AM default
  const awakenTask = state.tasks.find(t => t.id === 'task-awaken' || t.anchorId === 'ANCHOR_1_AWAKEN');
  const hasCompletedMorningAnchor = awakenTask?.completed;

  // If awaken task exists and is past wake + 20m uncompleted and we haven't recovered today
  if (awakenTask && !awakenTask.completed && currentMinutes >= (plannedWake + 20) && currentMinutes < PROTECTED_FAMILY_START) {
    const drift = currentMinutes - plannedWake;
    lateWakeDetected = true;
    lateWakeDriftMinutes = drift;

    const recovery = executeLateWakeRecovery(state, currentMinutes, activeClock);
    Object.assign(state, recovery.state);
    events.push(...recovery.events);

    const recNotifId = `notif-late-wake-${currentDate}-${Math.floor(currentMinutes / 60)}`;
    if (!notifications.some(n => n.id === recNotifId)) {
      notifications.unshift({
        id: recNotifId,
        timestamp: nowIso,
        type: 'RECOVERY',
        title: 'Autonomous Late Wake Recovery Applied',
        message: `Detected wake drift of +${drift}m. Morning anchors compressed to tier fallbacks to protect 4:00 PM family boundary.`,
        priority: 'HIGH',
        read: false,
        metadata: { driftMinutes: drift, wakeMinutes: currentMinutes },
      });
      notificationsGenerated++;
    }
  }

  // -------------------------------------------------------------------------
  // 3. EXPIRED ALLOCATION DETECTION & TASK WINDOW HYGIENE
  // -------------------------------------------------------------------------
  let hasExpiredTasks = false;
  state.tasks = state.tasks.map(task => {
    const taskEnd = task.allocatedEndMinutes ?? task.endMinutes;
    // Task window has expired past a 5-min grace buffer
    if (!task.completed && currentMinutes > (taskEnd + 5)) {
      hasExpiredTasks = true;
      expiredTasksMarked.push(task.id);
      if (task.isNonNegotiable) {
        missedAnchorsHandled.push(task.id);
      }

      // Log deviation for non-negotiables if not already logged
      const devExists = (state.deviations || []).some(
        d => d.activityId === task.id && d.type === 'MISSED_WINDOW' && d.timestamp.startsWith(currentDate)
      );

      if (task.isNonNegotiable && !devExists) {
        const devId = `dev-missed-${task.id}-${Date.now()}`;
        const deviation: DeviationRecord = {
          id: devId,
          timestamp: nowIso,
          activityId: task.id,
          type: 'MISSED_WINDOW',
          severity: 'HIGH',
          likelyCause: `Time window expired past scheduled end (${formatMinutesTo12Hour(taskEnd)})`,
          impactSummary: `Non-negotiable anchor ${task.title} missed time window.`,
          isResolved: true,
          resolvedAutonomously: true,
        };
        state.deviations = [deviation, ...(state.deviations || [])];

        const devEvt = createSystemEvent(
          'DeviationLogged',
          task.id,
          { deviationId: devId, taskTitle: task.title, scheduledEnd: taskEnd, currentMinutes },
          state,
          'SYSTEM_KERNEL',
          undefined,
          activeClock
        );
        events.push(devEvt);
      }

      return {
        ...task,
        executionStatus: 'MISSED_LATE',
        missedWindow: true,
      };
    }
    return task;
  });

  // Re-calculate dynamic allocations if any task expired or schedule shifted
  if (hasExpiredTasks || state.dynamicAllocations.length === 0) {
    const allocs = calculateDynamicAllocations(state);
    state.dynamicAllocations = allocs.allocations;
    state.tasks = allocs.recalculatedTasks;
    expiredAllocationsCount = expiredTasksMarked.length;
  }

  // -------------------------------------------------------------------------
  // 4. ROUTINE & EXECUTION STATE EVALUATION
  // -------------------------------------------------------------------------
  const routineEval = evaluateRoutineState(state);
  if (state.routineState !== routineEval.routineState) {
    state.routineState = routineEval.routineState;
    if (routineEval.reason) state.routineChangeReason = routineEval.reason;
  }

  // -------------------------------------------------------------------------
  // 5. TOMORROW PLAN FEASIBILITY EVALUATION (EVENING / BACKGROUND)
  // -------------------------------------------------------------------------
  if (state.tomorrowPlan) {
    const feas = evaluateTomorrowFeasibility(state.tomorrowPlan, state);
    state.tomorrowPlan.lastFeasibilityResult = feas;
  }

  // -------------------------------------------------------------------------
  // 6. TIME-SENSITIVE DECISION GENERATION
  // -------------------------------------------------------------------------
  const decisionEval = getAutonomousNextDecision(state);
  if (decisionEval.isUrgent && !state.activeHumanDecision) {
    state.activeHumanDecision = {
      id: `decision-${Date.now()}`,
      title: decisionEval.phaseTitle || 'Immediate Execution Decision Required',
      description: decisionEval.phaseDesc,
      reason: decisionEval.decisionReason || 'Schedule adaptation requires confirmation',
      options: [
        { id: 'opt_proceed', label: 'Proceed with Compressed Fallback', description: 'Lock minimum viable anchor requirements and maintain schedule.', consequence: 'Compresses flexible morning buffers to preserve protected boundaries.' },
        { id: 'opt_override', label: 'Manual Schedule Adjustment', description: 'Override anchor windows manually.', consequence: 'Requires manual timeline adjustment.' },
      ],
      urgency: 'HIGH',
      createdAt: nowIso,
    };
    decisionsGenerated++;
  }

  // -------------------------------------------------------------------------
  // 7. TIME-SENSITIVE NOTIFICATIONS (PROACTIVE REMINDERS)
  // -------------------------------------------------------------------------
  // 15-minute reminder before Protected Family Window (4:00 PM / 960m)
  if (currentMinutes >= 945 && currentMinutes <= 960) {
    const familyNotifId = `notif-family-prep-${currentDate}`;
    if (!notifications.some(n => n.id === familyNotifId)) {
      notifications.unshift({
        id: familyNotifId,
        timestamp: nowIso,
        type: 'TIME_CRITICAL',
        title: '15 Min Until Protected Family Time (4:00 PM)',
        message: 'Begin deep work wrap-up and tactical shutdown. Hard stop at 4:00 PM.',
        priority: 'HIGH',
        read: false,
      });
      notificationsGenerated++;
    }
  }

  // 15-minute reminder before any appointment
  for (const apt of state.tomorrowPlan?.appointments || []) {
    const reminderMin = apt.startMinutes - 15;
    if (currentMinutes >= reminderMin && currentMinutes <= apt.startMinutes) {
      const aptNotifId = `notif-apt-${apt.id}-${currentDate}`;
      if (!notifications.some(n => n.id === aptNotifId)) {
        notifications.unshift({
          id: aptNotifId,
          timestamp: nowIso,
          type: 'TIME_CRITICAL',
          title: `Upcoming: ${apt.title}`,
          message: `Starts at ${formatMinutesTo12Hour(apt.startMinutes)} ${apt.location ? `(${apt.location})` : ''}`,
          priority: 'NORMAL',
          read: false,
        });
        notificationsGenerated++;
      }
    }
  }

  // -------------------------------------------------------------------------
  // 8. ADAPTATION PROCESSING (AGGREGATE RECURRING DEVIATIONS)
  // -------------------------------------------------------------------------
  const missedCount = (state.deviations || []).filter(d => d.type === 'MISSED_WINDOW').length;
  if (missedCount >= 3) {
    const propExists = (state.adaptationProposals || []).some(p => p.status === 'PROPOSED' && p.title.includes('Window'));
    if (!propExists) {
      state.adaptationProposals = [
        {
          id: `prop-auto-buffer-${Date.now()}`,
          title: 'Autonomous Buffer Expansion for Morning Anchors',
          description: 'Detected 3+ missed morning windows across recent days. Proposes expanding baseline morning buffer by 10 minutes.',
          pillar: 'morning',
          status: 'PROPOSED',
          impactScore: 88,
          suggestedChange: {
            property: 'morningBufferMinutes',
            fromValue: 0,
            toValue: 10,
          },
          createdAt: nowIso,
        },
        ...(state.adaptationProposals || []),
      ];
      adaptationsTriggered++;
    }
  }

  // -------------------------------------------------------------------------
  // 9. MAINTENANCE & HYGIENE
  // -------------------------------------------------------------------------
  // Retain maximum 60 most recent notifications
  state.notifications = notifications.slice(0, 60);

  // -------------------------------------------------------------------------
  // 10. RECONCILIATION RESULT SUMMARY & SCHEDULER UPDATE
  // -------------------------------------------------------------------------
  const summaryParts: string[] = [];
  if (dayBoundaryCrossed) summaryParts.push(`Crossed day boundary into ${currentDate}`);
  if (dayActivated) summaryParts.push('Day activated with full task blueprint');
  if (lateWakeDetected) summaryParts.push(`Late wake (+${lateWakeDriftMinutes}m) compressed`);
  if (expiredTasksMarked.length > 0) summaryParts.push(`${expiredTasksMarked.length} expired task(s) marked`);
  if (summaryParts.length === 0) summaryParts.push('State aligned with authoritative clock');

  const result: LifecycleReconciliationResult = {
    reconciledAt: nowIso,
    timeDriftMinutes: lateWakeDriftMinutes,
    dayBoundaryCrossed,
    previousDate: prevActiveDate,
    newDate: currentDate,
    dayActivated,
    expiredAllocationsCount,
    expiredTasksMarked,
    missedAnchorsHandled,
    lateWakeDetected,
    lateWakeDriftMinutes,
    decisionsGenerated,
    notificationsGenerated,
    adaptationsTriggered,
    summary: summaryParts.join(' | '),
  };

  // Update Background Jobs Registry
  const updateJob = (jobType: BackgroundJobRecord['type'], summary: string, hasRun: boolean) => {
    if (!state.scheduler) return;
    state.scheduler.jobs = (state.scheduler.jobs || []).map(j => {
      if (j.type === jobType) {
        return {
          ...j,
          status: 'COMPLETED',
          lastRunAt: hasRun ? nowIso : j.lastRunAt,
          executionCount: hasRun ? j.executionCount + 1 : j.executionCount,
          lastResultSummary: summary,
        };
      }
      return j;
    });
  };

  updateJob('DAY_BOUNDARY_TRANSITION', dayBoundaryCrossed ? `Boundary transitioned from ${prevActiveDate} to ${currentDate}` : 'No boundary crossing needed', dayBoundaryCrossed);
  updateJob('DAY_ACTIVATION', dayActivated ? `Day activated for ${currentDate}` : 'Day already active', dayActivated);
  updateJob('SCHEDULED_EXECUTION_EVALUATION', `Routine evaluated: ${state.routineState}`, true);
  updateJob('EXPIRED_ALLOCATION_DETECTION', `${expiredAllocationsCount} expired allocations detected`, true);
  updateJob('TOMORROW_PLAN_EVALUATION', state.tomorrowPlan?.lastFeasibilityResult ? `Feasibility: ${state.tomorrowPlan.lastFeasibilityResult.feasibilityScore}/100` : 'Plan ready', true);
  updateJob('TIME_SENSITIVE_DECISION', decisionsGenerated > 0 ? `${decisionsGenerated} decisions generated` : 'No blocking decisions pending', true);
  updateJob('NOTIFICATION_GENERATION', notificationsGenerated > 0 ? `${notificationsGenerated} notifications queued` : 'Queue in sync', true);
  updateJob('ADAPTATION_PROCESSING', adaptationsTriggered > 0 ? 'Adaptation proposed' : 'Deviations tracked', true);
  updateJob('MAINTENANCE_CLEANUP', 'Hygiene check complete', true);

  if (state.scheduler) {
    state.scheduler.lastTickAt = nowIso;
    state.scheduler.lastReconciliation = result;
    state.scheduler.totalJobsExecuted = (state.scheduler.totalJobsExecuted || 0) + 1;
    state.scheduler.successfulJobsCount = (state.scheduler.successfulJobsCount || 0) + 1;
  }

  // Record audit events to durable store
  if (events.length > 0) {
    defaultDurableEventStore.appendBatch(events).catch(() => {});
  }

  return { state, result, events };
}
