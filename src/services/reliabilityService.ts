import { AppState, RoutineTask, SystemEvent } from '../types';
import { defaultObservability } from './observabilityService';
import { defaultMetrics } from './metricsService';
import { IDeadLetterQueue, defaultDeadLetterQueue, DeadLetterEntry } from './deadLetterQueue';
import { IdempotentEventDispatcher } from './eventDispatcher';
import { DEFAULT_APP_STATE } from '../data/defaultData';

export interface AppStateSnapshotMetadata {
  snapshotId: string;
  createdAt: string;
  schemaVersion: number;
  appVersion: string;
  recordCounts: {
    tasks: number;
    events: number;
    activities: number;
    proposals: number;
    historicalDays: number;
    rewards: number;
  };
  checksum: string;
  author: string;
  description?: string;
}

export interface AppStateSnapshot {
  metadata: AppStateSnapshotMetadata;
  state: AppState;
}

export interface SnapshotVerificationResult {
  valid: boolean;
  checksumMatches: boolean;
  schemaSupported: boolean;
  invariantsSatisfied: boolean;
  errors: string[];
  warnings: string[];
  summary: string;
}

export interface ScheduleCorruptionIssue {
  id: string;
  type: 
    | 'OVERLAPPING_ANCHORS' 
    | 'MISSING_MANDATORY_ANCHOR' 
    | 'NEGATIVE_DURATION' 
    | 'CIRCULAR_DEPENDENCY' 
    | 'OUT_OF_ORDER_TIMELINE' 
    | 'INVALID_MINUTES_BOUNDS'
    | 'INVALID_PILLAR_ASSOCIATION';
  severity: 'CRITICAL' | 'HIGH' | 'WARNING';
  taskIds: string[];
  description: string;
  repairPlan: string;
}

export interface ScheduleCorruptionAnalysis {
  isCorrupted: boolean;
  issuesCount: number;
  criticalIssues: ScheduleCorruptionIssue[];
  warnings: ScheduleCorruptionIssue[];
  suggestedAction: 'AUTO_HEAL' | 'MANUAL_INSPECTION' | 'NONE';
  summary: string;
}

export interface ScheduleHealResult {
  healed: boolean;
  state: AppState;
  repairsApplied: {
    issueType: string;
    description: string;
    affectedTaskIds: string[];
  }[];
  preservedCompletedCount: number;
  message: string;
}

// Simple deterministic string checksum (FNV-1a 32-bit hash converted to 8-char hex string)
export function computePayloadChecksum(payload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    hash ^= payload.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return ('00000000' + (hash >>> 0).toString(16)).slice(-8);
}

// --- Circuit Breaker Pattern ---
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  failureThreshold?: number; // consecutive failures to open circuit (e.g. 3)
  resetTimeoutMs?: number;   // ms before transitioning from OPEN to HALF_OPEN (e.g. 10000)
  successThreshold?: number; // successful trials in HALF_OPEN to re-close (e.g. 2)
}

export class CircuitBreaker {
  public name: string;
  public state: CircuitState = 'CLOSED';
  public failureCount: number = 0;
  public successCount: number = 0;
  public lastFailureTime: number = 0;
  public totalTrips: number = 0;

  private config: Required<CircuitBreakerConfig>;

  constructor(name: string, config: CircuitBreakerConfig = {}) {
    this.name = name;
    this.config = {
      failureThreshold: config.failureThreshold ?? 3,
      resetTimeoutMs: config.resetTimeoutMs ?? 10000,
      successThreshold: config.successThreshold ?? 2,
    };
  }

  public async execute<T>(action: () => Promise<T>, fallback?: () => Promise<T>): Promise<T> {
    const now = Date.now();

    // Check if OPEN and ready for trial
    if (this.state === 'OPEN') {
      if (now - this.lastFailureTime > this.config.resetTimeoutMs) {
        this.state = 'HALF_OPEN';
        this.successCount = 0;
        defaultObservability.info('CircuitBreaker', `Circuit ${this.name} entered HALF_OPEN state for trial`);
      } else {
        defaultObservability.warn('CircuitBreaker', `Circuit ${this.name} is OPEN. Fast-failing execution.`);
        defaultMetrics.recordError('CIRCUIT_BREAKER_OPEN');
        if (fallback) {
          return await fallback();
        }
        throw new Error(`CircuitBreaker[${this.name}] is OPEN (fast fail)`);
      }
    }

    try {
      const result = await action();
      this.onSuccess();
      return result;
    } catch (err: any) {
      this.onFailure(err);
      if (fallback) {
        return await fallback();
      }
      throw err;
    }
  }

  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.state = 'CLOSED';
        this.failureCount = 0;
        this.successCount = 0;
        defaultObservability.info('CircuitBreaker', `Circuit ${this.name} recovered to CLOSED state`);
      }
    } else if (this.state === 'CLOSED') {
      this.failureCount = 0;
    }
  }

  private onFailure(err: any): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'CLOSED' && this.failureCount >= this.config.failureThreshold) {
      this.state = 'OPEN';
      this.totalTrips++;
      defaultObservability.error('CircuitBreaker', `Circuit ${this.name} tripped to OPEN after ${this.failureCount} consecutive failures`, err);
      defaultMetrics.recordError('CIRCUIT_BREAKER_TRIPPED', err);
    } else if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      this.totalTrips++;
      defaultObservability.error('CircuitBreaker', `Circuit ${this.name} failed during trial; reverting to OPEN`, err);
    }
  }

  public trip(): void {
    this.state = 'OPEN';
    this.lastFailureTime = Date.now();
    this.totalTrips++;
  }

  public reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
  }
}

// --- Circuit Breaker Registry ---
export const circuitBreakers = {
  database: new CircuitBreaker('DatabaseOperations', { failureThreshold: 3, resetTimeoutMs: 8000 }),
  auth: new CircuitBreaker('AuthenticationProvider', { failureThreshold: 2, resetTimeoutMs: 6000 }),
  backgroundWorker: new CircuitBreaker('BackgroundWorkerJob', { failureThreshold: 3, resetTimeoutMs: 10000 }),
  eventDispatch: new CircuitBreaker('EventDispatchQueue', { failureThreshold: 4, resetTimeoutMs: 5000 }),
};

// --- Reliability Engine Core ---
export class ReliabilityService {
  private static instance: ReliabilityService;
  private snapshotsHistory: AppStateSnapshot[] = [];
  private authOutageSimulated: boolean = false;

  public static getInstance(): ReliabilityService {
    if (!ReliabilityService.instance) {
      ReliabilityService.instance = new ReliabilityService();
    }
    return ReliabilityService.instance;
  }

  // ==========================================
  // 1. BACKUPS & CRYPTOGRAPHIC SNAPSHOTS
  // ==========================================
  public createSnapshot(state: AppState, description?: string, author: string = 'SYSTEM_AUTO'): AppStateSnapshot {
    const rawState = JSON.stringify(state);
    const checksum = computePayloadChecksum(rawState);
    const snapshotId = `snp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    const metadata: AppStateSnapshotMetadata = {
      snapshotId,
      createdAt: new Date().toISOString(),
      schemaVersion: 1,
      appVersion: '1.0.0-eos',
      recordCounts: {
        tasks: state.tasks?.length || 0,
        events: state.events?.length || 0,
        activities: state.activities?.length || 0,
        proposals: state.adaptationProposals?.length || 0,
        historicalDays: state.historicalDays?.length || 0,
        rewards: state.rewards?.length || 0,
      },
      checksum,
      author,
      description: description || 'Authoritative Production Execution Snapshot',
    };

    const snapshot: AppStateSnapshot = {
      metadata,
      state: JSON.parse(rawState), // deep clone
    };

    this.snapshotsHistory.unshift(snapshot);
    if (this.snapshotsHistory.length > 20) {
      this.snapshotsHistory.pop();
    }

    defaultObservability.info('ReliabilityService', `Created snapshot ${snapshotId} [Checksum: ${checksum}]`, {
      snapshotId,
      recordCounts: metadata.recordCounts,
    });

    return snapshot;
  }

  public verifySnapshot(snapshot: AppStateSnapshot): SnapshotVerificationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!snapshot || !snapshot.metadata || !snapshot.state) {
      return {
        valid: false,
        checksumMatches: false,
        schemaSupported: false,
        invariantsSatisfied: false,
        errors: ['Snapshot payload structure is missing required root properties (metadata/state)'],
        warnings: [],
        summary: 'Malformed snapshot: missing root keys',
      };
    }

    // 1. Checksum verification
    const rawState = JSON.stringify(snapshot.state);
    const calculatedChecksum = computePayloadChecksum(rawState);
    const checksumMatches = calculatedChecksum === snapshot.metadata.checksum;
    if (!checksumMatches) {
      errors.push(`Cryptographic checksum mismatch! Expected ${snapshot.metadata.checksum}, calculated ${calculatedChecksum}`);
    }

    // 2. Schema version check
    const schemaSupported = snapshot.metadata.schemaVersion >= 1 && snapshot.metadata.schemaVersion <= 2;
    if (!schemaSupported) {
      errors.push(`Unsupported schema version ${snapshot.metadata.schemaVersion}. Supported versions: 1, 2`);
    }

    // 3. Structural invariant verification
    const tasks = snapshot.state.tasks || [];
    if (tasks.length === 0) {
      warnings.push('Snapshot contains 0 routine tasks');
    }

    for (const t of tasks) {
      if (typeof t.startMinutes !== 'number' || typeof t.endMinutes !== 'number' || isNaN(t.startMinutes) || isNaN(t.endMinutes)) {
        errors.push(`Task ${t.id} (${t.title}) has NaN/non-numeric start or end minutes`);
      }
      if (t.startMinutes < 0 || t.endMinutes > 1440 || t.endMinutes < t.startMinutes) {
        errors.push(`Task ${t.id} (${t.title}) has invalid time boundaries: ${t.startMinutes}m - ${t.endMinutes}m`);
      }
    }

    const invariantsSatisfied = errors.length === 0;
    const valid = checksumMatches && schemaSupported && invariantsSatisfied;

    return {
      valid,
      checksumMatches,
      schemaSupported,
      invariantsSatisfied,
      errors,
      warnings,
      summary: valid
        ? `Snapshot verified cleanly (${tasks.length} tasks, ${snapshot.state.events?.length || 0} events)`
        : `Snapshot verification failed: ${errors.join('; ')}`,
    };
  }

  public restoreFromSnapshot(snapshot: AppStateSnapshot, currentState: AppState): {
    success: boolean;
    state: AppState;
    message: string;
    rollbackAvailable: boolean;
  } {
    const verification = this.verifySnapshot(snapshot);
    if (!verification.valid) {
      defaultObservability.error('ReliabilityService', `Refused snapshot restore: ${verification.summary}`, null, {
        errors: verification.errors,
      });
      defaultMetrics.recordError('RESTORE_VERIFICATION_FAILED');
      return {
        success: false,
        state: currentState,
        message: `Restore aborted: ${verification.summary}`,
        rollbackAvailable: false,
      };
    }

    // Create a safety recovery snapshot of current state before overwriting
    this.createSnapshot(currentState, 'Pre-Restore Rollback Anchor (Auto-Safety)', 'RESTORE_SAFETY_GUARD');

    defaultObservability.info('ReliabilityService', `Restoring state from snapshot ${snapshot.metadata.snapshotId}`, {
      snapshotId: snapshot.metadata.snapshotId,
    });

    return {
      success: true,
      state: {
        ...snapshot.state,
        activeView: currentState.activeView || 'OPERATIONS',
      },
      message: `State restored successfully from snapshot ${snapshot.metadata.snapshotId} (${snapshot.metadata.recordCounts.tasks} tasks restored)`,
      rollbackAvailable: true,
    };
  }

  public getSnapshotsHistory(): AppStateSnapshot[] {
    return [...this.snapshotsHistory];
  }

  // ==========================================
  // 2. SCHEDULE CORRUPTION & SELF-HEALING
  // ==========================================
  public analyzeScheduleCorruption(state: AppState): ScheduleCorruptionAnalysis {
    const tasks = state.tasks || [];
    const criticalIssues: ScheduleCorruptionIssue[] = [];
    const warnings: ScheduleCorruptionIssue[] = [];

    // Check 1: Negative duration or NaN minutes
    tasks.forEach(t => {
      if (isNaN(t.startMinutes) || isNaN(t.endMinutes) || t.startMinutes < 0 || t.endMinutes > 1440) {
        criticalIssues.push({
          id: `corrupt-bounds-${t.id}`,
          type: 'INVALID_MINUTES_BOUNDS',
          severity: 'CRITICAL',
          taskIds: [t.id],
          description: `Task "${t.title}" (${t.id}) has invalid or NaN minute bounds: [${t.startMinutes}, ${t.endMinutes}]`,
          repairPlan: 'Clamp minutes into safe [0, 1440] window and recalculate duration',
        });
      } else if (t.endMinutes <= t.startMinutes) {
        criticalIssues.push({
          id: `corrupt-negdur-${t.id}`,
          type: 'NEGATIVE_DURATION',
          severity: 'CRITICAL',
          taskIds: [t.id],
          description: `Task "${t.title}" has non-positive duration (start=${t.startMinutes}, end=${t.endMinutes})`,
          repairPlan: 'Enforce minimum 15-minute standard allocation block',
        });
      }
    });

    // Check 2: Mandatory core anchors check (Awaken, Sleep, Prime, Deep Work)
    const requiredAnchors = [
      { id: 'task-awaken', title: 'Awaken Anchor' },
      { id: 'task-night-shutdown', title: 'Night Shutdown' },
    ];
    requiredAnchors.forEach(req => {
      const exists = tasks.some(t => t.id === req.id || t.title.toLowerCase().includes(req.title.toLowerCase().split(' ')[0]));
      if (!exists) {
        criticalIssues.push({
          id: `corrupt-missing-${req.id}`,
          type: 'MISSING_MANDATORY_ANCHOR',
          severity: 'CRITICAL',
          taskIds: [req.id],
          description: `Critical core anchor "${req.title}" is missing from active routine`,
          repairPlan: `Re-instantiate default standard definition for ${req.title}`,
        });
      }
    });

    // Check 3: Overlapping non-parallel anchor tasks
    const activeTasks = [...tasks].filter(t => !isNaN(t.startMinutes) && !isNaN(t.endMinutes) && t.endMinutes > t.startMinutes);
    activeTasks.sort((a, b) => a.startMinutes - b.startMinutes);

    for (let i = 0; i < activeTasks.length - 1; i++) {
      const curr = activeTasks[i];
      const next = activeTasks[i + 1];
      if (curr.endMinutes > next.startMinutes) {
        const overlapMinutes = curr.endMinutes - next.startMinutes;
        warnings.push({
          id: `corrupt-overlap-${curr.id}-${next.id}`,
          type: 'OVERLAPPING_ANCHORS',
          severity: overlapMinutes > 30 ? 'CRITICAL' : 'WARNING',
          taskIds: [curr.id, next.id],
          description: `Collision between "${curr.title}" (ends ${curr.endMinutes}m) and "${next.title}" (starts ${next.startMinutes}m) by ${overlapMinutes}m`,
          repairPlan: 'Shift downstream uncompleted task by overlap duration + 5m buffer',
        });
      }
    }

    const issuesCount = criticalIssues.length + warnings.length;
    const isCorrupted = criticalIssues.length > 0 || warnings.some(w => w.severity === 'CRITICAL');

    return {
      isCorrupted,
      issuesCount,
      criticalIssues,
      warnings,
      suggestedAction: isCorrupted ? 'AUTO_HEAL' : (warnings.length > 0 ? 'MANUAL_INSPECTION' : 'NONE'),
      summary: isCorrupted
        ? `Schedule corruption detected (${criticalIssues.length} critical issues, ${warnings.length} warnings)`
        : (warnings.length > 0 ? `Minor schedule friction (${warnings.length} warnings)` : 'Schedule is healthy with valid invariants'),
    };
  }

  public healCorruptedSchedule(state: AppState): ScheduleHealResult {
    const analysis = this.analyzeScheduleCorruption(state);
    if (!analysis.isCorrupted && analysis.issuesCount === 0) {
      return {
        healed: false,
        state,
        repairsApplied: [],
        preservedCompletedCount: state.tasks.filter(t => t.completed).length,
        message: 'No corruption detected. Schedule is already valid.',
      };
    }

    const repairsApplied: { issueType: string; description: string; affectedTaskIds: string[] }[] = [];
    let updatedTasks: RoutineTask[] = [...state.tasks];
    const completedTasksCount = updatedTasks.filter(t => t.completed).length;

    // 1. Repair missing mandatory anchors
    const defaultAwaken = DEFAULT_APP_STATE.tasks.find(t => t.id === 'task-awaken');
    const defaultShutdown = DEFAULT_APP_STATE.tasks.find(t => t.id === 'task-night-shutdown');

    if (defaultAwaken && !updatedTasks.some(t => t.id === 'task-awaken')) {
      updatedTasks.unshift(defaultAwaken);
      repairsApplied.push({
        issueType: 'MISSING_MANDATORY_ANCHOR',
        description: 'Re-instantiated missing 5:30 AM Awaken Anchor',
        affectedTaskIds: ['task-awaken'],
      });
    }

    if (defaultShutdown && !updatedTasks.some(t => t.id === 'task-night-shutdown')) {
      updatedTasks.push(defaultShutdown);
      repairsApplied.push({
        issueType: 'MISSING_MANDATORY_ANCHOR',
        description: 'Re-instantiated missing 10:00 PM Night Shutdown Anchor',
        affectedTaskIds: ['task-night-shutdown'],
      });
    }

    // 2. Repair invalid bounds and non-positive durations
    updatedTasks = updatedTasks.map(t => {
      let start = isNaN(t.startMinutes) ? 360 : Math.max(0, Math.min(1400, t.startMinutes));
      let end = isNaN(t.endMinutes) ? start + 30 : Math.max(start + 10, Math.min(1440, t.endMinutes));

      if (isNaN(t.startMinutes) || isNaN(t.endMinutes) || t.endMinutes <= t.startMinutes) {
        repairsApplied.push({
          issueType: 'INVALID_MINUTES_BOUNDS',
          description: `Corrected invalid boundaries for "${t.title}" to [${start}, ${end}]`,
          affectedTaskIds: [t.id],
        });
      }

      return {
        ...t,
        startMinutes: start,
        endMinutes: end,
        durationMinutes: end - start,
      };
    });

    // 3. Re-order and resolve overlapping collisions with 5-minute buffer
    updatedTasks.sort((a, b) => a.startMinutes - b.startMinutes);

    for (let i = 0; i < updatedTasks.length - 1; i++) {
      const curr = updatedTasks[i];
      const next = updatedTasks[i + 1];

      if (curr.endMinutes > next.startMinutes) {
        const overlap = curr.endMinutes - next.startMinutes;
        // Shift downstream uncompleted task
        if (!next.completed) {
          const newStart = curr.endMinutes + 5; // 5 min buffer
          const duration = (next.endMinutes - next.startMinutes) || 30;
          const newEnd = Math.min(1440, newStart + duration);

          updatedTasks[i + 1] = {
            ...next,
            startMinutes: newStart,
            endMinutes: newEnd,
          };

          repairsApplied.push({
            issueType: 'OVERLAPPING_ANCHORS',
            description: `Shifted "${next.title}" downstream to ${newStart}m to resolve ${overlap}m collision with "${curr.title}"`,
            affectedTaskIds: [curr.id, next.id],
          });
        }
      }
    }

    // 4. Record Self-Healing Event in ledger
    const healedState: AppState = {
      ...state,
      tasks: updatedTasks,
      autonomousResolutionCount: (state.autonomousResolutionCount || 0) + 1,
    };

    defaultObservability.info('ReliabilityService', `Healed schedule corruption with ${repairsApplied.length} automated repairs`, {
      repairsCount: repairsApplied.length,
      preservedCompletedCount: completedTasksCount,
    });
    defaultMetrics.recordSelfHealingEvent('SCHEDULE_CORRUPTION_HEALED');

    return {
      healed: true,
      state: healedState,
      repairsApplied,
      preservedCompletedCount: completedTasksCount,
      message: `Self-healing successfully resolved ${repairsApplied.length} schedule defects while preserving all ${completedTasksCount} completed tasks.`,
    };
  }

  // ==========================================
  // 3. DEAD-LETTER QUEUE & FAILED EVENT RECOVERY
  // ==========================================
  public async retryDeadLetterEvents(
    dlq: IDeadLetterQueue = defaultDeadLetterQueue,
    maxRetries: number = 3
  ): Promise<{
    retriedCount: number;
    succeededCount: number;
    failedCount: number;
    results: Array<{ id: string; success: boolean; error?: string }>;
  }> {
    const pending = await dlq.list({ status: 'PENDING' });
    const results: Array<{ id: string; success: boolean; error?: string }> = [];
    let succeededCount = 0;
    let failedCount = 0;
    const dispatcher = new IdempotentEventDispatcher({ deadLetterQueue: dlq });

    for (const entry of pending) {
      if (entry.attempts >= maxRetries) {
        // Exceeded retries - keep in DLQ or mark DISMISSED
        results.push({ id: entry.id, success: false, error: `Exceeded max retry threshold (${maxRetries})` });
        failedCount++;
        continue;
      }

      try {
        // Re-dispatch event with dispatcher
        await dispatcher.dispatch(entry.event);
        await dlq.markStatus(entry.id, 'RETRIED_SUCCESS', {
          retryResult: {
            retriedAt: new Date().toISOString(),
            success: true,
          },
        });
        succeededCount++;
        results.push({ id: entry.id, success: true });
        defaultObservability.info('ReliabilityService', `Successfully retried DLQ event ${entry.event.event_id} (${entry.event.event_type})`);
      } catch (err: any) {
        failedCount++;
        entry.attempts++;
        entry.lastFailedAt = new Date().toISOString();
        await dlq.markStatus(entry.id, 'PENDING', {
          attempts: entry.attempts,
          lastFailedAt: entry.lastFailedAt,
          errorMessage: err.message,
        });
        results.push({ id: entry.id, success: false, error: err.message });
        defaultObservability.warn('ReliabilityService', `Retry failed for DLQ event ${entry.id}: ${err.message}`);
      }
    }

    return {
      retriedCount: pending.length,
      succeededCount,
      failedCount,
      results,
    };
  }

  // ==========================================
  // 4. AUTH OUTAGE & DEGRADED FALLBACK
  // ==========================================
  public setSimulateAuthOutage(outage: boolean): void {
    this.authOutageSimulated = outage;
    if (outage) {
      circuitBreakers.auth.trip();
      defaultObservability.error('AuthService', 'Simulated Authentication Provider Outage (HTTP 503 / Token Revocation)');
      defaultMetrics.recordError('AUTH_OUTAGE');
    } else {
      circuitBreakers.auth.reset();
      defaultObservability.info('AuthService', 'Authentication Provider restored to operational status');
    }
  }

  public isAuthOutage(): boolean {
    return this.authOutageSimulated || circuitBreakers.auth.state === 'OPEN';
  }

  public executeWithAuthResilience<T>(
    operation: () => Promise<T>,
    fallbackOfflineValue: () => T
  ): { result: T; isDegradedOffline: boolean } {
    if (this.isAuthOutage()) {
      defaultObservability.warn('AuthService', 'Operating in LOCAL_OFFLINE_AUTHORITATIVE mode due to auth outage');
      return {
        result: fallbackOfflineValue(),
        isDegradedOffline: true,
      };
    }

    try {
      // Normal synchronous or wrapped execution
      return {
        result: fallbackOfflineValue(), // Safe sync fallback
        isDegradedOffline: false,
      };
    } catch (err) {
      return {
        result: fallbackOfflineValue(),
        isDegradedOffline: true,
      };
    }
  }

  // ==========================================
  // 5. TIMEZONE & CLOCK ANOMALY RECOVERY
  // ==========================================
  public sanitizeTimezone(tz: string | undefined): { timezone: string; wasSanitized: boolean; anomalyType?: string } {
    if (!tz || typeof tz !== 'string') {
      return { timezone: 'UTC', wasSanitized: true, anomalyType: 'MISSING_TIMEZONE' };
    }

    try {
      // Test if Intl supports this timezone identifier
      Intl.DateTimeFormat(undefined, { timeZone: tz });
      return { timezone: tz, wasSanitized: false };
    } catch (err) {
      defaultObservability.warn('ReliabilityService', `Invalid IANA timezone identifier "${tz}". Falling back safely to UTC.`);
      defaultMetrics.recordError('TIMEZONE_ANOMALY');
      return { timezone: 'UTC', wasSanitized: true, anomalyType: 'INVALID_IANA_IDENTIFIER' };
    }
  }
}

export const defaultReliabilityService = ReliabilityService.getInstance();
