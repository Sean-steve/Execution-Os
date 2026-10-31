import { describe, it, expect } from 'vitest';
import { ScenarioBuilder, verifyEventCorrelationChain } from './fixtures/scenarioBuilder';
import { evaluateRoutineState } from '../services/routineEngine';
import { calculateDynamicAllocations } from '../services/allocationEngine';
import { PROTECTED_FAMILY_START, PROTECTED_FAMILY_END } from './fixtures/legacyStandaloneScheduleConstants';
import { scanAndResolveDeviations } from '../services/deviationEngine';
import { getAutonomousNextDecision } from '../services/decisionEngine';
import { checkTaskDependencies } from '../services/dependencyEngine';
import { InMemoryExecutionRepository } from '../services/repository';

describe('EOS-013 — Golden Acceptance Scenario (Full End-to-End Simulation)', () => {
  it('executes canonical EOS-013 night-before plan followed by 06:35 late wake and complete autonomous recovery', async () => {
    // ==========================================
    // STAGE 1: Night-Before Blueprint Setup
    // ==========================================
    const nightBeforeState = ScenarioBuilder.create()
      .withTime('21:00')
      .withDayType('STANDARD')
      .withTomorrowPlan({
        top3: ['Deep Work Build Execution OS', 'Company Outreach Sprint', 'Family Evening Presence'],
        scheduleFocus: 'Heavy Builder Day',
        plannedMeal: 'Clean Whole Foods & Protein',
        workoutType: 'Zone 2 / Kettlebell',
        companyPriority: 'Execution OS core testing and stability',
        familyActivity: 'Dinner & Outdoor Park Walk (Protected)',
        tradingConditions: 'Only verified A+ setups',
      })
      .withTrading({
        isTradingDay: true,
        marketAnalyzed: false,
        setupDetected: false,
        noSetupJustified: false,
      })
      .build();

    const repo = new InMemoryExecutionRepository();
    await repo.saveState(nightBeforeState);

    // ==========================================
    // STAGE 2: Simulation of Actual Wake at 06:35 (395 mins)
    // 65 minutes past nominal 05:30 wake time
    // ==========================================
    let activeState = ScenarioBuilder.create(nightBeforeState)
      .withTime('06:35')
      .withUncompletedAll()
      .build();

    // 1. Routine Engine detects drift and transitions to COMPRESSED
    const routineEval = evaluateRoutineState(activeState);
    expect(routineEval.routineState).toBe('COMPRESSED');
    expect(routineEval.isCompressed).toBe(true);
    expect(routineEval.canExecuteAutonomousRecovery).toBe(true);
    activeState.routineState = routineEval.routineState;
    activeState.routineChangeReason = routineEval.reason;

    // 2. Deviation Engine scans and emits DeviationRecord + InterventionRecord
    const deviationScan = scanAndResolveDeviations(activeState);
    expect(deviationScan.hasNewDeviations).toBe(true);
    expect(deviationScan.detectedDeviations.length).toBeGreaterThan(0);
    
    const lateDev = deviationScan.detectedDeviations.find(d => d.type === 'LATE' || d.type === 'MISSED');
    expect(lateDev).toBeDefined();
    expect(lateDev?.isResolved).toBe(true);
    expect(lateDev?.resolvedAutonomously).toBe(true);

    activeState = deviationScan.updatedState;

    // 3. Allocation Engine dynamically reallocates day without encroaching family block
    const allocationResult = calculateDynamicAllocations(activeState);
    expect(allocationResult.allocations.length).toBeGreaterThan(0);
    expect(allocationResult.isFeasible).toBe(true);
    expect(allocationResult.hasScheduleCompression).toBe(true);

    activeState.dynamicAllocations = allocationResult.allocations;
    activeState.tasks = allocationResult.recalculatedTasks;

    // Verify critical anchors are preserved
    const criticalTaskIds = ['task-awaken', 'task-command-center', 'task-deep-work-build', 'task-family-connection'];
    criticalTaskIds.forEach(id => {
      const task = activeState.tasks.find(t => t.id === id);
      expect(task).toBeDefined();
    });

    // Verify non-family work allocations strictly avoid family block (16:00 to 19:30)
    const workAllocations = allocationResult.allocations.filter(a =>
      a.activityId === 'task-deep-work-build' ||
      a.activityId === 'task-trading-protocol' ||
      a.activityId === 'task-operational-buffer' ||
      a.activityId === 'task-company-of-day'
    );

    workAllocations.forEach(alloc => {
      const overlapsFamily = 
        alloc.allocatedStartMinutes < PROTECTED_FAMILY_END && 
        alloc.allocatedEndMinutes > PROTECTED_FAMILY_START;
      expect(overlapsFamily).toBe(false);
    });

    // 4. Trading Gatekeeper verification (Trading blocked until analysis & setup verified)
    const tradeDepCheck = checkTaskDependencies(activeState, 'task-trading-execution');
    expect(tradeDepCheck.isBlocked).toBe(true);
    expect(tradeDepCheck.blockingReasons.some(r => r.includes('Market Analysis'))).toBe(true);

    // 5. Decision Intelligence generates immediate executable next action with explanation
    const nextDecision = getAutonomousNextDecision(activeState);
    expect(nextDecision.currentTask).toBeDefined();
    expect(nextDecision.decisionReason).toBeDefined();
    expect(nextDecision.decisionReason.length).toBeGreaterThan(10);
    expect(nextDecision.availableFallbackTiers.length).toBeGreaterThanOrEqual(1);

    // 6. Persist resulting state and verify round-trip
    await repo.saveState(activeState);
    const persistedState = await repo.loadState();
    expect(persistedState?.routineState).toBe('COMPRESSED');
    expect(persistedState?.simulatedTime).toBe('06:35');
    expect(persistedState?.dynamicAllocations.length).toBeGreaterThan(0);

    // 7. Verify event correlation chain integrity
    expect(verifyEventCorrelationChain(activeState.events)).toBe(true);
  });
});
