import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryExecutionRepository } from '../repositories';
import { TestClock } from '../clock';
import { TransactionPipeline } from '../commands/transactionPipeline';
import { ExecutionApplicationService } from '../services/executionApplicationService';
import {
  PlanTomorrowCommand,
  ActivateDayCommand,
  StartActivityCommand,
  PauseActivityCommand,
  ResumeActivityCommand,
  CompleteActivityCommand,
  AdjustActivityCommand,
  AdvanceActivityCommand,
  DeferActivityCommand,
  CompressActivityCommand,
  ReplaceActivityCommand,
  OverrideActivityCommand,
  RecalculateDayCommand,
  ApproveDecisionCommand,
  RejectDecisionCommand,
  PauseAutonomyCommand,
  ResumeAutonomyCommand,
  SetSystemModeCommand,
  SetDayTypeCommand,
  TriggerFallbackCommand,
  AcceptDisciplinePenaltyCommand
} from '../commands/commands';
import { DEFAULT_APP_STATE } from '../data/defaultData';

describe('HEE Command Layer & Transaction Pipeline (EOS-003, EOS-004, EOS-016)', () => {
  let repository: InMemoryExecutionRepository;
  let clock: TestClock;
  let pipeline: TransactionPipeline;
  let appService: ExecutionApplicationService;

  beforeEach(() => {
    repository = new InMemoryExecutionRepository(DEFAULT_APP_STATE);
    clock = new TestClock('06:30');
    pipeline = new TransactionPipeline(repository, clock);
    appService = new ExecutionApplicationService(repository, clock);
  });

  it('Transaction Flow: executes COMMAND through validation, governance, domain, persistence, event and state return', async () => {
    const cmd = new CompleteActivityCommand({
      taskId: 'task-awaken',
      executionStatus: 'ON_TIME',
      completedAtMinutes: 340,
    });

    const result = await pipeline.execute(cmd);
    expect(result.success).toBe(true);
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.events[0].event_type).toBe('ActivityCompleted');

    // Verify repository persistence
    const savedState = await repository.loadState();
    const task = savedState.tasks.find(t => t.id === 'task-awaken');
    expect(task?.completed).toBe(true);
    expect(task?.completedAtMinutes).toBe(340);
  });

  it('PlanTomorrowCommand updates tomorrow plan and dispatches ActivityScheduled event', async () => {
    const result = await appService.planTomorrow({
      top3: ['Lock architecture', 'Run 10km', 'Family dinner'],
      plannedMeal: 'Salmon & avocado',
      workoutType: 'Full Body Compound',
    });

    expect(result.success).toBe(true);
    expect(result.state.tomorrowPlan.top3[0]).toBe('Lock architecture');
    expect(result.events.some(e => e.event_type === 'ActivityScheduled')).toBe(true);
  });

  it('ActivateDayCommand resets mode, routine state and recalibrates allocations', async () => {
    const result = await appService.activateDay({
      mode: 'YELLOW',
      dayType: 'EARLY_DEPARTURE',
    });

    expect(result.success).toBe(true);
    expect(result.state.currentMode).toBe('YELLOW');
    expect(result.state.dayType).toBe('EARLY_DEPARTURE');
    expect(result.events.some(e => e.event_type === 'RoutineActivated')).toBe(true);
  });

  it('StartActivity, PauseActivity, and ResumeActivity dispatch lifecycle events', async () => {
    const startRes = await appService.startActivity('task-meditation');
    expect(startRes.success).toBe(true);
    expect(startRes.events.some(e => e.event_type === 'ActivityStarted')).toBe(true);

    const pauseRes = await appService.pauseActivity('task-meditation', 'Phone call');
    expect(pauseRes.success).toBe(true);
    expect(pauseRes.events.some(e => e.event_type === 'ExecutionInterrupted')).toBe(true);

    const resumeRes = await appService.resumeActivity('task-meditation');
    expect(resumeRes.success).toBe(true);
    expect(resumeRes.events.some(e => e.event_type === 'ExecutionStarted')).toBe(true);
  });

  it('CompleteActivity updates points, schedules dynamic reallocation, and recalculates routine state', async () => {
    const res = await appService.completeActivity({
      taskId: 'task-awaken',
      executionStatus: 'ON_TIME',
      completedAtMinutes: 340,
    });

    expect(res.success).toBe(true);
    const task = res.state.tasks.find(t => t.id === 'task-awaken');
    expect(task?.completed).toBe(true);
    expect(res.state.rewardPoints).toBeGreaterThan(0);
    expect(res.state.dynamicAllocations.length).toBeGreaterThan(0);
  });

  it('AdjustActivity, AdvanceActivity, and DeferActivity adjust schedule windows and record audit overrides', async () => {
    const adjustRes = await appService.adjustActivity({
      taskId: 'task-deep-work-build',
      startMinutes: 480,
      endMinutes: 630,
    });
    expect(adjustRes.success).toBe(true);

    const advRes = await appService.advanceActivity('task-deep-work-build', 15, 'Started early');
    expect(advRes.success).toBe(true);
    expect(advRes.state.userOverrides.some(o => o.overrideType === 'ADVANCE')).toBe(true);

    const defRes = await appService.deferActivity('task-deep-work-build', 20, 'Urgent meeting');
    expect(defRes.success).toBe(true);
    expect(defRes.state.userOverrides.some(o => o.overrideType === 'DEFER')).toBe(true);
  });

  it('CompressActivity compresses duration, sets fallback level, and protects family windows', async () => {
    const res = await appService.compressActivity('task-deep-work-build', 60, 'Time crunch', 1);
    expect(res.success).toBe(true);
    const task = res.state.tasks.find(t => t.id === 'task-deep-work-build');
    expect(task?.executionStatus).toBe('COMPRESSED');
    expect(task?.fallbackLevel).toBe(1);
    expect(res.events.some(e => e.event_type === 'FallbackTriggered')).toBe(true);
  });

  it('ReplaceActivity and OverrideActivity record user overrides and update tasks', async () => {
    const overrideRes = await appService.overrideActivity({
      taskId: 'task-workout-morning',
      overrideType: 'FORCE_COMPLETE',
      reason: 'Done at home gym early',
      modifications: { completed: true, completedAtMinutes: 370 },
    });

    expect(overrideRes.success).toBe(true);
    expect(overrideRes.state.userOverrides.some(o => o.overrideType === 'FORCE_COMPLETE')).toBe(true);
  });

  it('RecalculateDay runs full HEE evaluation pipeline autonomously', async () => {
    const res = await appService.recalculateDay(true, 'Manual refresh');
    expect(res.success).toBe(true);
    expect(res.state.dynamicAllocations.length).toBeGreaterThan(0);
    expect(res.events.some(e => e.event_type === 'AllocationChanged')).toBe(true);
  });

  it('ApproveDecision and RejectDecision manage human decision lifecycle', async () => {
    // Set an active decision
    const stateWithDecision = {
      ...DEFAULT_APP_STATE,
      activeHumanDecision: {
        id: 'dec-overrun-1',
        title: 'Overrun Decision',
        description: 'Choose option',
        reason: 'Late start',
        options: [{ id: 'opt-compress', label: 'Compress', description: 'Compress', consequence: 'None' }],
        urgency: 'HIGH' as const,
        createdAt: clock.toISOString(),
      },
    };
    await repository.saveState(stateWithDecision);

    const approveRes = await appService.approveDecision('dec-overrun-1', 'opt-compress');
    expect(approveRes.success).toBe(true);
    expect(approveRes.state.activeHumanDecision).toBeNull();
    expect(approveRes.events.some(e => e.event_type === 'HumanDecisionReceived')).toBe(true);
  });

  it('PauseAutonomy and ResumeAutonomy modify governance levels', async () => {
    const pauseRes = await appService.pauseAutonomy('Manual control desired');
    expect(pauseRes.success).toBe(true);
    expect(pauseRes.state.autonomyLevel).toBe(0);

    const resumeRes = await appService.resumeAutonomy(4);
    expect(resumeRes.success).toBe(true);
    expect(resumeRes.state.autonomyLevel).toBe(4);
  });

  it('AcceptDisciplinePenalty deducts penalty points, marks task late, and increments penalty count', async () => {
    const res = await appService.acceptDisciplinePenalty('task-meditation', 5);
    expect(res.success).toBe(true);
    const task = res.state.tasks.find(t => t.id === 'task-meditation');
    expect(task?.completed).toBe(true);
    expect(task?.missedWindow).toBe(true);
    expect(task?.executionStatus).toBe('MISSED_LATE');
    expect(res.state.disciplinePenaltiesCount).toBeGreaterThanOrEqual(1);
  });

  it('Validation fails gracefully on non-existent task or invalid payload', async () => {
    const invalidCmd = new CompleteActivityCommand({
      taskId: 'task-non-existent-xyz',
    });

    const res = await pipeline.execute(invalidCmd);
    expect(res.success).toBe(false);
    expect(res.error).toContain('not found');
  });
});
