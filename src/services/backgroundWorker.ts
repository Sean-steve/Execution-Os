import { IExecutionRepository, defaultExecutionRepository } from '../repositories';
import { IClock, defaultClock, getClockForState } from '../clock';
import { AppState, BackgroundJobRecord, BackgroundJobType, BackgroundSchedulerState, ExecutionNotification, LifecycleReconciliationResult } from '../types';
import { reconcileLifecycleState, ReconciliationOptions } from './reconciliationEngine';

export interface BackgroundWorkerConfig {
  enabled?: boolean;
  tickIntervalMs?: number; // Base tick interval (e.g. 30000 = 30s)
  timezone?: string;
  autoStart?: boolean;
}

export class BackgroundWorker {
  private repository: IExecutionRepository;
  private clock: IClock;
  private timerHandle: any = null;
  private isRunning: boolean = false;
  private config: Required<BackgroundWorkerConfig>;
  private lastReconciliationResult: LifecycleReconciliationResult | null = null;
  private isTickExecuting: boolean = false;

  constructor(
    repository: IExecutionRepository = defaultExecutionRepository,
    clock: IClock = defaultClock,
    config: BackgroundWorkerConfig = {}
  ) {
    this.repository = repository;
    this.clock = clock;
    this.config = {
      enabled: config.enabled ?? true,
      tickIntervalMs: config.tickIntervalMs ?? 30000,
      timezone: config.timezone ?? 'UTC',
      autoStart: config.autoStart ?? false,
    };

    if (this.config.autoStart && this.config.enabled) {
      this.start();
    }
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.scheduleNextTick();
  }

  public stop(): void {
    this.isRunning = false;
    if (this.timerHandle) {
      clearTimeout(this.timerHandle);
      this.timerHandle = null;
    }
  }

  public isWorkerActive(): boolean {
    return this.isRunning;
  }

  /**
   * Calculates smart delay until next significant event to prevent continuous unnecessary polling
   */
  private calculateAdaptiveDelayMs(state: AppState): number {
    const activeClock = this.clock || getClockForState(state);
    const currentMinutes = activeClock.getCurrentTimeMinutes();

    // Find next upcoming task boundary
    let nextBoundaryMinutes = 1440; // Default: midnight
    for (const t of state.tasks) {
      const start = t.allocatedStartMinutes ?? t.startMinutes;
      const end = (t.allocatedEndMinutes ?? t.endMinutes) + 5;
      if (start > currentMinutes && start < nextBoundaryMinutes) {
        nextBoundaryMinutes = start;
      }
      if (end > currentMinutes && end < nextBoundaryMinutes) {
        nextBoundaryMinutes = end;
      }
    }

    const minutesUntilNext = Math.max(1, nextBoundaryMinutes - currentMinutes);
    // Minimum 15 seconds, maximum 5 minutes (300,000 ms), default gentle 30s
    const adaptiveMs = Math.min(300000, Math.max(15000, minutesUntilNext * 60000));
    return Math.min(this.config.tickIntervalMs, adaptiveMs);
  }

  private scheduleNextTick(): void {
    if (!this.isRunning || !this.config.enabled) return;

    if (this.timerHandle) {
      clearTimeout(this.timerHandle);
    }

    this.timerHandle = setTimeout(async () => {
      try {
        await this.tick();
      } catch (err) {
        console.error('[BackgroundWorker] Error during scheduler tick:', err);
      } finally {
        if (this.isRunning) {
          this.scheduleNextTick();
        }
      }
    }, this.config.tickIntervalMs);
  }

  /**
   * Authoritative Single-Pass Scheduled Tick (Idempotent & Retry-Safe)
   */
  public async tick(options: ReconciliationOptions = {}): Promise<{
    state: AppState;
    result: LifecycleReconciliationResult;
  }> {
    if (this.isTickExecuting) {
      // Prevent overlapping concurrent ticks
      const state = await this.repository.loadState();
      return {
        state,
        result: this.lastReconciliationResult || {
          reconciledAt: this.clock.toISOString(),
          timeDriftMinutes: 0,
          dayBoundaryCrossed: false,
          previousDate: state.activeDate || '',
          newDate: state.activeDate || '',
          dayActivated: false,
          expiredAllocationsCount: 0,
          expiredTasksMarked: [],
          missedAnchorsHandled: [],
          lateWakeDetected: false,
          lateWakeDriftMinutes: 0,
          decisionsGenerated: 0,
          notificationsGenerated: 0,
          adaptationsTriggered: 0,
          summary: 'Tick skipped: concurrent execution in progress',
        },
      };
    }

    this.isTickExecuting = true;
    const startTime = Date.now();

    try {
      const currentState = await this.repository.loadState();
      const reconciliation = reconcileLifecycleState(currentState, this.clock, {
        triggerOrigin: options.triggerOrigin || 'BACKGROUND_WORKER',
        forceDayBoundary: options.forceDayBoundary,
        targetMinutes: options.targetMinutes,
      });

      // Persist authoritatively
      await this.repository.saveState(reconciliation.state);
      this.lastReconciliationResult = reconciliation.result;

      return {
        state: reconciliation.state,
        result: reconciliation.result,
      };
    } catch (err: any) {
      console.error('[BackgroundWorker] Fatal error during state reconciliation:', err);
      throw err;
    } finally {
      this.isTickExecuting = false;
    }
  }

  /**
   * Run a specific isolated background job on demand
   */
  public async runJob(jobType: BackgroundJobType): Promise<{
    success: boolean;
    jobType: BackgroundJobType;
    durationMs: number;
    summary: string;
  }> {
    const start = Date.now();
    try {
      let options: ReconciliationOptions = {};
      if (jobType === 'DAY_BOUNDARY_TRANSITION' || jobType === 'DAY_ACTIVATION') {
        options.forceDayBoundary = true;
      }
      const tickResult = await this.tick(options);
      const durationMs = Date.now() - start;

      return {
        success: true,
        jobType,
        durationMs,
        summary: tickResult.result.summary,
      };
    } catch (err: any) {
      return {
        success: false,
        jobType,
        durationMs: Date.now() - start,
        summary: `Job failed: ${err.message}`,
      };
    }
  }

  /**
   * Inspect current worker status & telemetry
   */
  public async getStatus(): Promise<{
    isRunning: boolean;
    enabled: boolean;
    timezone: string;
    lastTickAt: string | null;
    lastReconciliation: LifecycleReconciliationResult | null;
    schedulerState: BackgroundSchedulerState | null;
    notifications: ExecutionNotification[];
  }> {
    const state = await this.repository.loadState();
    return {
      isRunning: this.isRunning,
      enabled: this.config.enabled,
      timezone: this.config.timezone,
      lastTickAt: state.scheduler?.lastTickAt || null,
      lastReconciliation: state.scheduler?.lastReconciliation || this.lastReconciliationResult,
      schedulerState: state.scheduler || null,
      notifications: state.notifications || [],
    };
  }

  public setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    if (!enabled) {
      this.stop();
    } else {
      this.start();
    }
  }
}

export const defaultBackgroundWorker = new BackgroundWorker(
  defaultExecutionRepository,
  defaultClock,
  { autoStart: false } // In dev/test, started on demand or via createApp
);
