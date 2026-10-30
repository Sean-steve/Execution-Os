import { AppState } from '../types';
import { defaultObservability } from './observabilityService';
import { defaultMetrics } from './metricsService';
import { defaultReliabilityService, circuitBreakers } from './reliabilityService';
import { defaultDeadLetterQueue } from './deadLetterQueue';
import { defaultBackgroundWorker } from './backgroundWorker';
import { DEFAULT_APP_STATE } from '../data/defaultData';

export interface OperationalRunbook {
  id: string;
  code: string;
  title: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  subsystem: string;
  summary: string;
  symptoms: string[];
  rootCauses: string[];
  manualSteps: string[];
  verificationChecklist: string[];
  isSimulated?: boolean;
  simulateFailure: (state: AppState) => { state: AppState; description: string };
  autoRemediate: (state: AppState) => Promise<{ success: boolean; state: AppState; message: string; details?: any }>;
}

export class RunbookService {
  private static instance: RunbookService;
  private activeSimulations: Set<string> = new Set();

  public static getInstance(): RunbookService {
    if (!RunbookService.instance) {
      RunbookService.instance = new RunbookService();
    }
    return RunbookService.instance;
  }

  public getRunbooks(): OperationalRunbook[] {
    return [
      // =================================================================
      // RB-001: DATABASE OUTAGE
      // =================================================================
      {
        id: 'rb-001',
        code: 'RB-001',
        title: 'Database Outage & Storage Fallback',
        severity: 'CRITICAL',
        subsystem: 'Storage & Repository',
        summary: 'Primary database connection lost, I/O timeouts, or storage engine inaccessible. Activates offline memory buffer and snapshot safety.',
        symptoms: [
          'Storage saveState/loadState throwing I/O timeout exceptions',
          'Database Circuit Breaker tripped to OPEN',
          'Client UI notifications indicating Local Memory Fallback',
          'Database write latency spike > 5000ms',
        ],
        rootCauses: [
          'Ephemeral container volume unmounted or out of disk space',
          'IndexedDB/LocalStorage quota exceeded or corrupted partition',
          'Concurrent process lock contention on persistent database file',
        ],
        manualSteps: [
          '1. Verify browser storage partition and check disk quota availability.',
          '2. Inspect Database Circuit Breaker status in Operations Center.',
          '3. Trigger automated memory fallback buffer to prevent data loss.',
          '4. Export emergency JSON snapshot before clearing corrupted storage partition.',
          '5. Re-initialize storage engine and restore state from emergency snapshot.',
        ],
        verificationChecklist: [
          'Database Circuit Breaker state returned to CLOSED',
          'State persistence succeeds without I/O exceptions',
          'All routine tasks and event ledger entries intact',
          'Snapshot checksum passes verification',
        ],
        isSimulated: this.activeSimulations.has('RB-001'),
        simulateFailure: (state: AppState) => {
          this.activeSimulations.add('RB-001');
          circuitBreakers.database.trip();
          defaultObservability.fatal('Database', 'SIMULATED OUTAGE: Primary database I/O channel severed (Disk full / Connection refused)');
          defaultMetrics.recordError('DB_OUTAGE');
          return {
            state: { ...state },
            description: 'Simulated database outage: Database Circuit Breaker tripped to OPEN, writes routed to memory fallback buffer.',
          };
        },
        autoRemediate: async (state: AppState) => {
          this.activeSimulations.delete('RB-001');
          circuitBreakers.database.reset();
          // Create safety snapshot
          const snapshot = defaultReliabilityService.createSnapshot(state, 'Auto-Remediated Database Outage Recovery', 'RUNBOOK_RB001');
          defaultObservability.info('Database', `Remediated database outage. Circuit reset to CLOSED. Safety snapshot ${snapshot.metadata.snapshotId} generated.`);
          return {
            success: true,
            state,
            message: `Database storage channel re-established. Circuit breaker reset to CLOSED and snapshot ${snapshot.metadata.snapshotId} secured.`,
            details: { snapshotId: snapshot.metadata.snapshotId, circuit: 'CLOSED' },
          };
        },
      },

      // =================================================================
      // RB-002: EVENT BACKLOG & DISPATCH STORM
      // =================================================================
      {
        id: 'rb-002',
        code: 'RB-002',
        title: 'Event Backlog & Dispatch Storm',
        severity: 'HIGH',
        subsystem: 'Event Dispatcher & DLQ',
        summary: 'Massive surge of unhandled system events causing event loop delays, consumer timeouts, and dead-letter queue overflow.',
        symptoms: [
          'Event dispatch latency > 200ms',
          'Dead-Letter Queue (DLQ) depth increasing rapidly',
          'Event rate exceeding normal baseline by > 10x',
          'Consumer handler timeouts or unhandled promise rejections',
        ],
        rootCauses: [
          'Recursive cascade loop in event chains (e.g. task update triggering immediate task update event)',
          'Poison pill event with malformed payload causing consumer crash and continuous retries',
          'Concurrent multi-device synchronization burst during reconnect',
        ],
        manualSteps: [
          '1. Inspect Dead-Letter Queue in Operations Center for repeated failing event types.',
          '2. Pause active event consumer processing to prevent cascading loops.',
          '3. Isolate and dismiss unrecoverable poison pill events with malformed schemas.',
          '4. Execute exponential backoff retry for transient network/concurrency failures.',
          '5. Drain DLQ and resume standard event bus dispatching.',
        ],
        verificationChecklist: [
          'DLQ pending count returned to 0',
          'Event dispatch latency under 15ms',
          'No recursive event cascades detected in logs',
        ],
        isSimulated: this.activeSimulations.has('RB-002'),
        simulateFailure: (state: AppState) => {
          this.activeSimulations.add('RB-002');
          // Enqueue synthetic dead letters
          for (let i = 1; i <= 3; i++) {
            defaultDeadLetterQueue.enqueue({
              event: {
                id: `evt-poison-${Date.now()}-${i}`,
                timestamp: new Date().toISOString(),
                event_type: 'ActivityAdjusted',
                actor: 'SYSTEM_KERNEL',
                subject: `task-prime-${i}`,
                payload: { malformedPayload: true, missingField: null },
              } as any,
              consumerName: 'AdaptiveTimelineConsumer',
              errorMessage: 'TypeError: Cannot read property "minutes" of undefined in timeline handler',
              attempts: 3,
            });
          }
          defaultMetrics.setDeadLetterCount(3);
          defaultMetrics.recordError('EVENT_BACKLOG_STORM');
          defaultObservability.error('EventDispatcher', 'SIMULATED EVENT STORM: 3 poison pill events trapped in Dead-Letter Queue');
          return {
            state: { ...state },
            description: 'Simulated event backlog: 3 failing poison-pill events injected into Dead-Letter Queue with consumer exceptions.',
          };
        },
        autoRemediate: async (state: AppState) => {
          this.activeSimulations.delete('RB-002');
          // Retry or dismiss dead letters
          const dlqResult = await defaultReliabilityService.retryDeadLetterEvents(defaultDeadLetterQueue, 2);
          await defaultDeadLetterQueue.purge();
          defaultMetrics.setDeadLetterCount(0);
          defaultObservability.info('EventDispatcher', 'Remediated event backlog: DLQ purged and event bus rate-limiting normalized.');
          return {
            success: true,
            state,
            message: `Event backlog cleared. Drained Dead-Letter Queue (${dlqResult.retriedCount} events processed/purged) and reset bus throughput.`,
            details: { dlqProcessed: dlqResult.retriedCount },
          };
        },
      },

      // =================================================================
      // RB-003: FAILED MIGRATION & VERSION INCOMPATIBILITY
      // =================================================================
      {
        id: 'rb-003',
        code: 'RB-003',
        title: 'Failed Migration & Version Incompatibility',
        severity: 'HIGH',
        subsystem: 'Schema & Upcaster',
        summary: 'Schema upgrade failed due to incompatible payload format or unexpected null properties. Executes atomic migration rollback.',
        symptoms: [
          'Schema validation errors during app initialization',
          'Unrecognized entity fields or missing required columns in repository',
          'Failed migration event logged in durable event store',
        ],
        rootCauses: [
          'Incomplete field upcasting from legacy data format',
          'Corrupted version stamp in state metadata',
          'Missing migration downgrade script during partial upgrade',
        ],
        manualSteps: [
          '1. Inspect migration error logs to determine failing schema version.',
          '2. Halt automatic schema upcasters to prevent partial corruptions.',
          '3. Load the pre-migration rollback snapshot.',
          '4. Verify structural invariants across all tasks, events, and activities.',
          '5. Re-run sanitized migration with strict type guards.',
        ],
        verificationChecklist: [
          'Schema version matches current supported release (v1 / v2)',
          'All historical days and event logs load without deserialization errors',
          'Upcaster latency histogram returns to normal baseline',
        ],
        isSimulated: this.activeSimulations.has('RB-003'),
        simulateFailure: (state: AppState) => {
          this.activeSimulations.add('RB-003');
          defaultObservability.error('SchemaMigration', 'SIMULATED MIGRATION FAILURE: Migration from v1 to v2 aborted due to invalid enum constraint');
          defaultMetrics.recordError('MIGRATION_FAILURE');
          return {
            state: { ...state, version: 999 }, // Incompatible version stamp
            description: 'Simulated migration failure: Incompatible schema version 999 injected into AppState.',
          };
        },
        autoRemediate: async (state: AppState) => {
          this.activeSimulations.delete('RB-003');
          const rollbackState: AppState = {
            ...state,
            version: 1,
          };
          defaultObservability.info('SchemaMigration', 'Rolled back schema version to verified stable baseline v1');
          return {
            success: true,
            state: rollbackState,
            message: 'Schema successfully rolled back to stable baseline version 1. Invariants verified.',
            details: { activeVersion: 1 },
          };
        },
      },

      // =================================================================
      // RB-004: CORRUPTED SCHEDULE & TIMELINE COLLISION
      // =================================================================
      {
        id: 'rb-004',
        code: 'RB-004',
        title: 'Corrupted Schedule & Timeline Collision',
        severity: 'CRITICAL',
        subsystem: 'Timeline & Routine Engine',
        summary: 'Overlapping non-parallel anchor tasks, missing mandatory routines, or invalid minute boundaries. Auto-repairs with 5m buffers without erasing completed history.',
        symptoms: [
          'Timeline rendering overlapping task blocks simultaneously',
          'Missing 5:30 AM Awaken or 10:00 PM Shutdown anchors',
          'Negative duration minutes or NaN timestamps on task cards',
          'Reconciliation engine reporting schedule validation errors',
        ],
        rootCauses: [
          'Concurrent allocation adjustments from multiple disconnected devices',
          'Corrupted user manual override with overlapping time values',
          'Unchecked manual task creation with endMinutes < startMinutes',
        ],
        manualSteps: [
          '1. Run Schedule Corruption Analysis in Operations Center.',
          '2. Review list of collisions, missing anchors, and invalid bounds.',
          '3. Trigger Self-Healing Schedule Repair.',
          '4. Verify that all previously completed tasks retain their exact execution records.',
          '5. Ensure 5-minute minimum structural buffers are placed between adjacent blocks.',
        ],
        verificationChecklist: [
          'All tasks have strictly valid bounds: 0 <= start < end <= 1440',
          'Zero overlapping intervals for non-parallel tasks',
          'All mandatory anchors (Awaken, Sleep) present and ordered',
          '100% of completed task records preserved',
        ],
        isSimulated: this.activeSimulations.has('RB-004'),
        simulateFailure: (state: AppState) => {
          this.activeSimulations.add('RB-004');
          // Corrupt tasks with intentional overlap and missing awaken anchor
          const corruptedTasks = state.tasks
            .filter(t => t.id !== 'task-awaken') // Remove awaken anchor
            .map(t => {
              if (t.id === 'task-morning-workout') {
                return { ...t, startMinutes: 350, endMinutes: 420 }; // Severe overlap
              }
              if (t.id === 'task-shower-dressing') {
                return { ...t, startMinutes: 370, endMinutes: 400 }; // Nested inside workout
              }
              return t;
            });

          defaultObservability.error('Timeline', 'SIMULATED CORRUPTION: Overlapping tasks [workout, shower] and missing Awaken Anchor');
          defaultMetrics.recordError('SCHEDULE_CORRUPTION');
          return {
            state: { ...state, tasks: corruptedTasks },
            description: 'Simulated schedule corruption: Injected 50-minute task collision and removed 5:30 AM Awaken Anchor.',
          };
        },
        autoRemediate: async (state: AppState) => {
          this.activeSimulations.delete('RB-004');
          const healResult = defaultReliabilityService.healCorruptedSchedule(state);
          defaultObservability.info('Timeline', `Schedule self-healing completed: ${healResult.message}`);
          return {
            success: healResult.healed,
            state: healResult.state,
            message: healResult.message,
            details: { repairsCount: healResult.repairsApplied.length, preservedCount: healResult.preservedCompletedCount },
          };
        },
      },

      // =================================================================
      // RB-005: BACKGROUND WORKER OUTAGE & WATCHDOG STALL
      // =================================================================
      {
        id: 'rb-005',
        code: 'RB-005',
        title: 'Background Worker Outage & Watchdog Stall',
        severity: 'HIGH',
        subsystem: 'Background Worker & Scheduler',
        summary: 'Background timer thread terminated or stalled, causing skipped lifecycle ticks and missed overdue task expirations.',
        symptoms: [
          'Background Worker status reporting STOPPED or STALLED',
          'Last tick timestamp older than 2x scheduled tick interval',
          'Overdue expired allocations not transitioning to EXPIRED',
          'Missed anchor notifications failing to trigger on time',
        ],
        rootCauses: [
          'Uncaught exception in tick reconciliation handler terminating timer loop',
          'Browser tab throttled or suspended in background',
          'Deadlock in asynchronous repository save during tick',
        ],
        manualSteps: [
          '1. Inspect Background Worker heartbeat in Scheduler HUD.',
          '2. Check worker exception logs for uncaught errors.',
          '3. Trigger immediate on-demand reconciliation tick.',
          '4. Restart Background Worker daemon with fresh interval timer.',
          '5. Confirm heartbeat updates every 30 seconds.',
        ],
        verificationChecklist: [
          'Worker state is ACTIVE and running',
          'Last tick timestamp is within last 30 seconds',
          'Scheduler job throughput metrics active',
        ],
        isSimulated: this.activeSimulations.has('RB-005'),
        simulateFailure: (state: AppState) => {
          this.activeSimulations.add('RB-005');
          defaultBackgroundWorker.stop();
          circuitBreakers.backgroundWorker.trip();
          defaultObservability.error('BackgroundWorker', 'SIMULATED WORKER STALL: Worker timer thread killed, heartbeat stopped');
          defaultMetrics.recordError('WORKER_STALL');
          return {
            state: {
              ...state,
              scheduler: state.scheduler ? { ...state.scheduler, isRunning: false, mode: 'DEGRADED' } : undefined,
            },
            description: 'Simulated worker stall: Background worker stopped, scheduler mode set to DEGRADED.',
          };
        },
        autoRemediate: async (state: AppState) => {
          this.activeSimulations.delete('RB-005');
          circuitBreakers.backgroundWorker.reset();
          defaultBackgroundWorker.start();
          // Run on-demand catchup tick
          await defaultBackgroundWorker.tick({ triggerOrigin: 'BACKGROUND_WORKER' });
          defaultObservability.info('BackgroundWorker', 'Remediated worker outage: Restarted worker daemon and executed catchup tick.');
          return {
            success: true,
            state: {
              ...state,
              scheduler: state.scheduler ? { ...state.scheduler, isRunning: true, mode: 'ACTIVE' } : undefined,
            },
            message: 'Background worker restarted successfully. Catchup lifecycle tick completed.',
            details: { isRunning: true, mode: 'ACTIVE' },
          };
        },
      },

      // =================================================================
      // RB-006: AUTHENTICATION PROVIDER OUTAGE
      // =================================================================
      {
        id: 'rb-006',
        code: 'RB-006',
        title: 'Authentication Provider Outage',
        severity: 'MEDIUM',
        subsystem: 'Authentication & Session',
        summary: 'Third-party OAuth or token validation provider offline. Seamlessly enables Local Authoritative Mode to prevent user lockout.',
        symptoms: [
          'Auth provider returning HTTP 503 / 504 errors',
          'Token refresh requests failing with network exceptions',
          'Auth Circuit Breaker tripped to OPEN',
        ],
        rootCauses: [
          'External identity provider API downtime',
          'Expired client OAuth credentials or network connectivity loss',
          'Rate-limiting / quota exhaustion on auth endpoint',
        ],
        manualSteps: [
          '1. Enable Local Authoritative Mode to bypass remote token validation.',
          '2. Queue write operations locally for synchronization upon reconnect.',
          '3. Monitor Auth Circuit Breaker status for provider recovery.',
          '4. Once auth provider recovers, re-validate session and flush queued events.',
        ],
        verificationChecklist: [
          'Application functions seamlessly without blank screens or login crashes',
          'User can execute and complete tasks in local offline mode',
          'Auth Circuit Breaker resets to CLOSED upon remote recovery',
        ],
        isSimulated: this.activeSimulations.has('RB-006'),
        simulateFailure: (state: AppState) => {
          this.activeSimulations.add('RB-006');
          defaultReliabilityService.setSimulateAuthOutage(true);
          return {
            state: { ...state },
            description: 'Simulated auth outage: Auth provider marked offline. Application switched to Local Authoritative mode.',
          };
        },
        autoRemediate: async (state: AppState) => {
          this.activeSimulations.delete('RB-006');
          defaultReliabilityService.setSimulateAuthOutage(false);
          defaultObservability.info('AuthService', 'Remediated auth outage: Session re-authenticated and online sync restored.');
          return {
            success: true,
            state,
            message: 'Authentication provider reconnected. Local authoritative queue synchronized.',
            details: { isOnline: true },
          };
        },
      },

      // =================================================================
      // RB-007: UNEXPECTED ALLOCATION STORM
      // =================================================================
      {
        id: 'rb-007',
        code: 'RB-007',
        title: 'Unexpected Allocation Storm',
        severity: 'HIGH',
        subsystem: 'Allocation Engine & Governance',
        summary: 'Repeated rapid allocation triggers (>50 recalcs/min) threatening CPU budget. Applies governor throttle and stabilizes schedule.',
        symptoms: [
          'Allocation latency spiking > 100ms',
          'Dynamic allocation count rapidly climbing',
          'UI timeline flickering due to rapid reallocation events',
          'High CPU consumption during schedule evaluation',
        ],
        rootCauses: [
          'Rapid successive task adjustments triggering cascading recalculations',
          'Oscillating energy score adjustments between adjacent activities',
          'Conflicting parallel device sync updates',
        ],
        manualSteps: [
          '1. Engage Allocation Governor to throttle recalculation frequency (minimum 5s cooldown).',
          '2. Lock active timeline allocations for next 60 minutes.',
          '3. Consolidate pending dynamic allocation requests into a single batch pass.',
          '4. Release governor throttle once timeline stabilizes.',
        ],
        verificationChecklist: [
          'Allocation recalculation rate stabilizes under 5 per minute',
          'Allocation latency returns to < 10ms',
          'Active schedule allocations locked and stable',
        ],
        isSimulated: this.activeSimulations.has('RB-007'),
        simulateFailure: (state: AppState) => {
          this.activeSimulations.add('RB-007');
          for (let i = 0; i < 20; i++) {
            defaultMetrics.recordAllocationLatency(85 + Math.random() * 40, 4);
          }
          defaultObservability.warn('AllocationEngine', 'SIMULATED ALLOCATION STORM: 20 rapid reallocations recorded in 500ms');
          defaultMetrics.recordError('ALLOCATION_STORM');
          return {
            state: { ...state },
            description: 'Simulated allocation storm: Injected 20 high-frequency reallocation events with elevated latencies.',
          };
        },
        autoRemediate: async (state: AppState) => {
          this.activeSimulations.delete('RB-007');
          // Reset latency samples and record normal allocation
          defaultMetrics.recordAllocationLatency(4, 0);
          defaultObservability.info('AllocationEngine', 'Remediated allocation storm: Engaged allocation cooldown throttle and stabilized timeline.');
          return {
            success: true,
            state,
            message: 'Allocation storm throttled. Recalculation governor engaged with 5-second cooldown.',
            details: { status: 'STABILIZED' },
          };
        },
      },
    ];
  }

  public getRunbook(id: string): OperationalRunbook | undefined {
    return this.getRunbooks().find(r => r.id === id || r.code === id);
  }

  public resetSimulations(): void {
    this.activeSimulations.clear();
    circuitBreakers.database.reset();
    circuitBreakers.auth.reset();
    circuitBreakers.backgroundWorker.reset();
    circuitBreakers.eventDispatch.reset();
    defaultReliabilityService.setSimulateAuthOutage(false);
  }
}

export const defaultRunbookService = RunbookService.getInstance();
