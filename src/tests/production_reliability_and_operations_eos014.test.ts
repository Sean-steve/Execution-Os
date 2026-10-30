import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_APP_STATE } from '../data/defaultData';
import { AppState, RoutineTask } from '../types';
import { ObservabilityService, defaultObservability } from '../services/observabilityService';
import { TracingService, defaultTracing } from '../services/tracingService';
import { MetricsService, defaultMetrics } from '../services/metricsService';
import { 
  ReliabilityService, 
  defaultReliabilityService, 
  computePayloadChecksum, 
  CircuitBreaker, 
  circuitBreakers 
} from '../services/reliabilityService';
import { RunbookService, defaultRunbookService } from '../services/runbookService';
import { MemoryDeadLetterQueue } from '../services/deadLetterQueue';

describe('Sprint 11: Production Reliability & Operations (EOS-014)', () => {
  let state: AppState;

  beforeEach(() => {
    state = JSON.parse(JSON.stringify(DEFAULT_APP_STATE));
    defaultObservability.clear();
    defaultTracing.clear();
    defaultMetrics.reset();
    defaultRunbookService.resetSimulations();
  });

  // =========================================================================
  // 1. OBSERVABILITY & STRUCTURED LOGGING
  // =========================================================================
  describe('1. Observability & Structured Logging Engine', () => {
    it('generates structured log entries with correlation IDs and metadata', () => {
      const obs = new ObservabilityService();
      const traceId = obs.generateTraceId('trc-test');

      const entry = obs.info(
        'DecisionEngine',
        'Evaluated 12 active routine rules',
        { rulesCount: 12, mode: 'GREEN' },
        { traceId, taskId: 'task-deep-work', action: 'EVALUATE' }
      );

      expect(entry.id).toBeDefined();
      expect(entry.level).toBe('INFO');
      expect(entry.service).toBe('DecisionEngine');
      expect(entry.message).toContain('Evaluated 12 active routine rules');
      expect(entry.correlation.traceId).toBe(traceId);
      expect(entry.correlation.taskId).toBe('task-deep-work');
      expect(entry.metadata?.rulesCount).toBe(12);

      // Query filter test
      const queried = obs.query({ service: 'DecisionEngine', level: 'INFO' });
      expect(queried.length).toBe(1);
      expect(queried[0].id).toBe(entry.id);
    });

    it('captures errors with code, stack, and FATAL classification', () => {
      const obs = new ObservabilityService();
      const customErr = new Error('Disk volume locked by concurrent transaction');
      (customErr as any).code = 'ERR_DISK_LOCK';

      const entry = obs.fatal(
        'StorageRepository',
        'Database write failed',
        customErr,
        { retryAttempt: 3 }
      );

      expect(entry.level).toBe('FATAL');
      expect(entry.error?.name).toBe('Error');
      expect(entry.error?.message).toContain('Disk volume locked');
      expect(entry.error?.code).toBe('ERR_DISK_LOCK');

      // Export formats
      const json = obs.exportJson();
      expect(json).toContain('ERR_DISK_LOCK');
      const ndjson = obs.exportNdjson();
      expect(ndjson).toContain('StorageRepository');
    });
  });

  // =========================================================================
  // 2. DISTRIBUTED REQUEST TRACING
  // =========================================================================
  describe('2. Distributed Request Tracing & Spans', () => {
    it('creates root traces and child spans with duration and status', async () => {
      const obs = new ObservabilityService();
      const tracing = new TracingService(obs);

      const result = await tracing.traceAsync(
        'ReconcileLifecycle',
        'BackgroundWorker',
        async (rootSpan) => {
          // Child span 1: scan expired allocations
          const childSpan1 = tracing.startSpan('ScanExpiredAllocations', rootSpan, 'AllocationEngine');
          tracing.logEventToSpan(childSpan1, 'Scanned 8 allocations');
          tracing.finishSpan(childSpan1, 'OK');

          // Child span 2: evaluate decisions
          const childSpan2 = tracing.startSpan('EvaluateDecisions', rootSpan, 'DecisionEngine');
          tracing.finishSpan(childSpan2, 'OK');

          return { reconciled: true, expiredCount: 0 };
        },
        undefined,
        { trigger: 'SCHEDULED_TICK' }
      );

      expect(result.reconciled).toBe(true);

      const traces = tracing.getRecentTraces();
      expect(traces.length).toBeGreaterThan(0);
      const rootTrace = traces[0];
      expect(rootTrace.rootOperation).toBe('ReconcileLifecycle');
      expect(rootTrace.spans.length).toBe(3); // root + 2 children
      expect(rootTrace.status).toBe('OK');
    });

    it('captures span errors and marks trace as ERROR status', async () => {
      const obs = new ObservabilityService();
      const tracing = new TracingService(obs);

      await expect(
        tracing.traceAsync('FailedOperation', 'ExternalSync', async () => {
          throw new Error('Sync connection timeout');
        })
      ).rejects.toThrow('Sync connection timeout');

      const traces = tracing.getRecentTraces();
      expect(traces[0].status).toBe('ERROR');
      expect(traces[0].spans[0].error?.message).toContain('Sync connection timeout');
    });
  });

  // =========================================================================
  // 3. OPERATIONAL METRICS & LATENCY PROFILING
  // =========================================================================
  describe('3. Telemetry & Metrics Engine', () => {
    it('computes latency percentiles (p50, p95, p99) and API error rates', () => {
      const metrics = new MetricsService();

      // Record 100 requests with varying latencies
      for (let i = 1; i <= 100; i++) {
        metrics.recordApiRequest('/api/reconcile', i * 2, i === 100 ? 500 : 200);
      }

      const snapshot = metrics.getSnapshot();
      expect(snapshot.api.totalRequests).toBe(100);
      expect(snapshot.api.errorCount).toBe(1);
      expect(snapshot.api.errorRatePercent).toBe(1);
      expect(snapshot.api.latency.min).toBe(2);
      expect(snapshot.api.latency.max).toBe(200);
      expect(snapshot.api.latency.p50).toBe(102);
      expect(snapshot.api.latency.p95).toBe(192);
      expect(snapshot.api.latency.p99).toBe(200);
    });

    it('tracks decision, allocation, job, autonomous resolution, and governance metrics', () => {
      const metrics = new MetricsService();

      metrics.recordDecisionLatency(4.5, 15, 2);
      metrics.recordAllocationLatency(8.2, 3);
      metrics.recordJobExecution('SCHEDULED_EXECUTION_EVALUATION', 12, true);
      metrics.recordJobExecution('SCHEDULED_EXECUTION_EVALUATION', 14, true);
      metrics.recordSelfHealingEvent('SCHEDULE_CORRUPTION_HEALED');
      metrics.recordAutoAppliedProposal();
      metrics.recordAutonomousFallback();
      metrics.recordGovernanceApproval('TIER_1');
      metrics.recordUnauthorizedVeto();
      metrics.recordError('CIRCUIT_BREAKER_TRIPPED');

      const snapshot = metrics.getSnapshot();
      expect(snapshot.decision.evaluationsCount).toBe(1);
      expect(snapshot.decision.rulesEvaluatedCount).toBe(15);
      expect(snapshot.allocation.reallocationsCount).toBe(1);
      expect(snapshot.allocation.tasksShiftedCount).toBe(3);
      expect(snapshot.backgroundJobs.jobsSucceeded).toBe(2);
      expect(snapshot.autonomousResolution.selfHealingEventsCount).toBe(1);
      expect(snapshot.autonomousResolution.autoAppliedProposalsCount).toBe(1);
      expect(snapshot.governance.tier1ApprovalsCount).toBe(1);
      expect(snapshot.governance.unauthorizedAttemptsVetoed).toBe(1);
      expect(snapshot.errors.categorizedErrors['CIRCUIT_BREAKER_TRIPPED']).toBe(1);
    });
  });

  // =========================================================================
  // 4. DATABASE SNAPSHOTS & CRYPTOGRAPHIC RESTORE
  // =========================================================================
  describe('4. State Snapshots & Cryptographic Disaster Recovery', () => {
    it('creates snapshots with valid cryptographic checksum and restores state cleanly', () => {
      const rel = new ReliabilityService();
      state.rewardPoints = 450;
      state.tasks[0].completed = true;

      const snapshot = rel.createSnapshot(state, 'Test Production Snapshot');
      expect(snapshot.metadata.snapshotId).toBeDefined();
      expect(snapshot.metadata.checksum).toBeDefined();
      expect(snapshot.metadata.recordCounts.tasks).toBe(state.tasks.length);

      // Verify snapshot
      const verification = rel.verifySnapshot(snapshot);
      expect(verification.valid).toBe(true);
      expect(verification.checksumMatches).toBe(true);
      expect(verification.invariantsSatisfied).toBe(true);

      // Mutate state
      const alteredState: AppState = {
        ...state,
        rewardPoints: 0,
        tasks: [],
      };

      // Restore from snapshot
      const restoreResult = rel.restoreFromSnapshot(snapshot, alteredState);
      expect(restoreResult.success).toBe(true);
      expect(restoreResult.state.rewardPoints).toBe(450);
      expect(restoreResult.state.tasks.length).toBe(state.tasks.length);
      expect(restoreResult.state.tasks[0].completed).toBe(true);
    });

    it('rejects tampered or corrupt snapshots with checksum mismatch', () => {
      const rel = new ReliabilityService();
      const snapshot = rel.createSnapshot(state, 'Tamper Test');

      // Tamper state without updating checksum
      snapshot.state.rewardPoints = 999999;

      const verification = rel.verifySnapshot(snapshot);
      expect(verification.valid).toBe(false);
      expect(verification.checksumMatches).toBe(false);
      expect(verification.errors.some(e => e.includes('checksum mismatch'))).toBe(true);

      const restoreResult = rel.restoreFromSnapshot(snapshot, state);
      expect(restoreResult.success).toBe(false);
      expect(restoreResult.message).toContain('Restore aborted');
    });

    it('rejects snapshots with invalid structural invariants (NaN bounds or negative durations)', () => {
      const rel = new ReliabilityService();
      const snapshot = rel.createSnapshot(state, 'Invariant Test');

      // Introduce NaN bounds
      snapshot.state.tasks[0].startMinutes = NaN;
      // Recompute checksum to pass checksum check but fail invariant check
      snapshot.metadata.checksum = computePayloadChecksum(JSON.stringify(snapshot.state));

      const verification = rel.verifySnapshot(snapshot);
      expect(verification.valid).toBe(false);
      expect(verification.invariantsSatisfied).toBe(false);
      expect(verification.errors.some(e => e.includes('NaN/non-numeric'))).toBe(true);
    });
  });

  // =========================================================================
  // 5. SCHEDULE CORRUPTION DETECTION & SELF-HEALING
  // =========================================================================
  describe('5. Schedule Corruption & Self-Healing Engine', () => {
    it('detects missing core anchors and overlapping task collisions', () => {
      const rel = new ReliabilityService();

      // Corrupt state: remove Awaken anchor and make workout & shower overlap heavily
      const corruptedTasks: RoutineTask[] = state.tasks
        .filter(t => t.id !== 'task-awaken')
        .map(t => {
          if (t.id === 'task-workout-morning') {
            return { ...t, startMinutes: 360, endMinutes: 420 };
          }
          if (t.id === 'task-shower-morning') {
            return { ...t, startMinutes: 380, endMinutes: 410 }; // overlaps
          }
          return t;
        });

      const corruptedState: AppState = { ...state, tasks: corruptedTasks };
      const analysis = rel.analyzeScheduleCorruption(corruptedState);

      expect(analysis.isCorrupted).toBe(true);
      expect(analysis.issuesCount).toBeGreaterThan(0);
      expect(analysis.criticalIssues.some(i => i.type === 'MISSING_MANDATORY_ANCHOR')).toBe(true);
      expect(analysis.warnings.some(i => i.type === 'OVERLAPPING_ANCHORS')).toBe(true);
    });

    it('heals corrupted schedule by re-injecting missing anchors and spacing collisions with 5m buffer', () => {
      const rel = new ReliabilityService();

      // Mark first task completed to ensure completed history is preserved
      state.tasks[1].completed = true;
      const initialCompletedCount = state.tasks.filter(t => t.completed).length;

      // Corrupt schedule
      const corruptedTasks: RoutineTask[] = state.tasks
        .filter(t => t.id !== 'task-awaken')
        .map(t => {
          if (t.id === 'task-workout-morning') {
            return { ...t, startMinutes: 360, endMinutes: 420 };
          }
          if (t.id === 'task-shower-morning') {
            return { ...t, startMinutes: 380, endMinutes: 410 };
          }
          return t;
        });

      const corruptedState: AppState = { ...state, tasks: corruptedTasks };
      const healResult = rel.healCorruptedSchedule(corruptedState);

      expect(healResult.healed).toBe(true);
      expect(healResult.repairsApplied.length).toBeGreaterThan(0);
      expect(healResult.preservedCompletedCount).toBe(initialCompletedCount);

      // Verify Awaken anchor is restored
      expect(healResult.state.tasks.some(t => t.id === 'task-awaken')).toBe(true);

      // Verify overlap is resolved
      const workout = healResult.state.tasks.find(t => t.id === 'task-workout-morning')!;
      const shower = healResult.state.tasks.find(t => t.id === 'task-shower-morning')!;
      expect(shower.startMinutes).toBeGreaterThanOrEqual(workout.endMinutes + 5);

      // Verify all completed tasks remain completed
      expect(healResult.state.tasks.filter(t => t.completed).length).toBe(initialCompletedCount);
    });
  });

  // =========================================================================
  // 6. DEAD-LETTER QUEUE & EXPONENTIAL BACKOFF RETRY
  // =========================================================================
  describe('6. Dead-Letter Queue (DLQ) & Event Recovery', () => {
    it('enqueues failed events, supports query/filter, and retries with backoff', async () => {
      const dlq = new MemoryDeadLetterQueue();
      const rel = new ReliabilityService();

      const entry = await dlq.enqueue({
        event: {
          id: 'evt-test-fail-1',
          timestamp: new Date().toISOString(),
          event_type: 'ActivityCompleted',
          actor: 'USER',
          subject: 'task-deep-work',
          payload: { taskId: 'task-deep-work' },
        } as any,
        consumerName: 'AdaptiveTimelineConsumer',
        errorMessage: 'Database connection timeout on consumer update',
        attempts: 1,
      });

      expect(entry.id).toBeDefined();
      expect(entry.status).toBe('PENDING');

      const list = await dlq.list({ status: 'PENDING' });
      expect(list.length).toBe(1);

      // Retry failed events
      const retryResult = await rel.retryDeadLetterEvents(dlq, 3);
      expect(retryResult.retriedCount).toBe(1);
      expect(retryResult.succeededCount).toBe(1);

      const pendingAfter = await dlq.list({ status: 'PENDING' });
      expect(pendingAfter.length).toBe(0);
    });
  });

  // =========================================================================
  // 7. CIRCUIT BREAKER RESILIENCE
  // =========================================================================
  describe('7. Circuit Breaker Lifecycle & Fast-Fail', () => {
    it('transitions CLOSED -> OPEN -> HALF_OPEN -> CLOSED on failures and recovery', async () => {
      const breaker = new CircuitBreaker('TestService', {
        failureThreshold: 2,
        resetTimeoutMs: 50,
        successThreshold: 1,
      });

      expect(breaker.state).toBe('CLOSED');

      // Failure 1
      await expect(breaker.execute(async () => { throw new Error('Fail 1'); })).rejects.toThrow('Fail 1');
      expect(breaker.state).toBe('CLOSED');

      // Failure 2 (trips circuit to OPEN)
      await expect(breaker.execute(async () => { throw new Error('Fail 2'); })).rejects.toThrow('Fail 2');
      expect(breaker.state).toBe('OPEN');

      // Fast-fail while OPEN
      await expect(breaker.execute(async () => 'OK')).rejects.toThrow('CircuitBreaker[TestService] is OPEN');

      // Wait for reset timeout
      await new Promise(r => setTimeout(r, 60));

      // Trial in HALF_OPEN succeeds -> transitions to CLOSED
      const result = await breaker.execute(async () => 'Recovered Value');
      expect(result).toBe('Recovered Value');
      expect(breaker.state).toBe('CLOSED');
      expect(breaker.failureCount).toBe(0);
    });
  });

  // =========================================================================
  // 8. AUTH OUTAGE DEGRADED MODE & TIMEZONE RECOVERY
  // =========================================================================
  describe('8. Auth Outage Graceful Degradation & Timezone Anomaly Recovery', () => {
    it('operates in LOCAL_OFFLINE_AUTHORITATIVE mode during auth provider outage without crashing', () => {
      const rel = new ReliabilityService();

      rel.setSimulateAuthOutage(true);
      expect(rel.isAuthOutage()).toBe(true);

      const execution = rel.executeWithAuthResilience(
        async () => { throw new Error('Remote OAuth 503'); },
        () => ({ localData: true, user: 'offline-authoritative-user' })
      );

      expect(execution.isDegradedOffline).toBe(true);
      expect(execution.result.user).toBe('offline-authoritative-user');

      // Restore auth
      rel.setSimulateAuthOutage(false);
      expect(rel.isAuthOutage()).toBe(false);
    });

    it('sanitizes invalid IANA timezone identifiers safely to UTC', () => {
      const rel = new ReliabilityService();

      const validResult = rel.sanitizeTimezone('America/New_York');
      expect(validResult.timezone).toBe('America/New_York');
      expect(validResult.wasSanitized).toBe(false);

      const invalidResult = rel.sanitizeTimezone('Mars/Olympus_Mons');
      expect(invalidResult.timezone).toBe('UTC');
      expect(invalidResult.wasSanitized).toBe(true);
      expect(invalidResult.anomalyType).toBe('INVALID_IANA_IDENTIFIER');
    });
  });

  // =========================================================================
  // 9. OPERATIONAL RUNBOOKS (RB-001 TO RB-007)
  // =========================================================================
  describe('9. Incident Runbooks (RB-001 through RB-007)', () => {
    it('executes all 7 runbook failure simulations and automated remediations', async () => {
      const runbookService = new RunbookService();
      const allRunbooks = runbookService.getRunbooks();

      expect(allRunbooks.length).toBe(7);

      for (const rb of allRunbooks) {
        // 1. Simulate failure
        const sim = rb.simulateFailure(state);
        expect(sim.description).toBeDefined();

        // 2. Execute 1-click automated remediation
        const rem = await rb.autoRemediate(sim.state);
        expect(rem.success).toBe(true);
        expect(rem.message).toBeDefined();
        expect(rem.state).toBeDefined();
      }
    });
  });
});
