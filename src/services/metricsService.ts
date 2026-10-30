export interface LatencyHistogram {
  count: number;
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
  recentSamples: number[];
}

export interface MetricTimeSeriesPoint {
  timestamp: string;
  value: number;
}

export interface OperationalMetricsSnapshot {
  timestamp: string;
  uptimeSeconds: number;
  api: {
    totalRequests: number;
    errorCount: number;
    errorRatePercent: number;
    latency: LatencyHistogram;
    endpoints: Record<string, { requests: number; errors: number; avgLatencyMs: number }>;
  };
  decision: {
    evaluationsCount: number;
    rulesEvaluatedCount: number;
    actionsEmittedCount: number;
    latency: LatencyHistogram;
  };
  allocation: {
    reallocationsCount: number;
    tasksShiftedCount: number;
    latency: LatencyHistogram;
  };
  backgroundJobs: {
    totalTicks: number;
    jobsExecuted: number;
    jobsSucceeded: number;
    jobsFailed: number;
    throughputPerMinute: number;
    lastTickDurationMs: number;
    jobTypes: Record<string, { count: number; failures: number; avgDurationMs: number }>;
  };
  eventProcessing: {
    eventsDispatched: number;
    eventsPersisted: number;
    dispatchRatePerSec: number;
    avgDispatchLatencyMs: number;
    deadLetterQueueCount: number;
    upcastingLatency: LatencyHistogram;
  };
  errors: {
    totalErrors: number;
    unhandledExceptions: number;
    categorizedErrors: Record<string, number>;
  };
  autonomousResolution: {
    selfHealingEventsCount: number;
    autoAppliedProposalsCount: number;
    gatedProposalsCount: number;
    autonomousFallbacksTriggered: number;
    autonomousResolutionRatePercent: number;
  };
  governance: {
    tier1ApprovalsCount: number;
    tier2ApprovalsCount: number;
    tier3ApprovalsCount: number;
    unauthorizedAttemptsVetoed: number;
    autonomyPausedRejections: number;
  };
}

export class MetricsService {
  private static instance: MetricsService;
  private startTime: number = Date.now();

  // Histograms
  private apiLatencies: number[] = [];
  private decisionLatencies: number[] = [];
  private allocationLatencies: number[] = [];
  private upcastingLatencies: number[] = [];

  // Counters
  private apiTotalRequests: number = 0;
  private apiErrorRequests: number = 0;
  private apiEndpoints: Map<string, { requests: number; errors: number; totalMs: number }> = new Map();

  private decisionEvaluations: number = 0;
  private decisionRulesEvaluated: number = 0;
  private decisionActionsEmitted: number = 0;

  private allocationCount: number = 0;
  private tasksShiftedCount: number = 0;

  private backgroundTicks: number = 0;
  private backgroundJobsExecuted: number = 0;
  private backgroundJobsSucceeded: number = 0;
  private backgroundJobsFailed: number = 0;
  private lastTickDurationMs: number = 0;
  private backgroundJobTypes: Map<string, { count: number; failures: number; totalDurationMs: number }> = new Map();

  private eventsDispatched: number = 0;
  private eventsPersisted: number = 0;
  private totalDispatchMs: number = 0;
  private deadLetterCount: number = 0;

  private totalErrors: number = 0;
  private unhandledExceptions: number = 0;
  private categorizedErrors: Map<string, number> = new Map();

  private selfHealingEvents: number = 0;
  private autoAppliedProposals: number = 0;
  private gatedProposals: number = 0;
  private autonomousFallbacks: number = 0;

  private tier1Approvals: number = 0;
  private tier2Approvals: number = 0;
  private tier3Approvals: number = 0;
  private unauthorizedVetoes: number = 0;
  private autonomyPausedRejections: number = 0;

  public static getInstance(): MetricsService {
    if (!MetricsService.instance) {
      MetricsService.instance = new MetricsService();
    }
    return MetricsService.instance;
  }

  private calculateHistogram(samples: number[], maxRecent: number = 100): LatencyHistogram {
    if (samples.length === 0) {
      return { count: 0, min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0, recentSamples: [] };
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const count = sorted.length;
    const sum = sorted.reduce((a, b) => a + b, 0);
    const min = sorted[0];
    const max = sorted[count - 1];
    const avg = Math.round((sum / count) * 10) / 10;

    const p50Index = Math.min(count - 1, Math.floor(count * 0.5));
    const p95Index = Math.min(count - 1, Math.floor(count * 0.95));
    const p99Index = Math.min(count - 1, Math.floor(count * 0.99));

    return {
      count,
      min,
      max,
      avg,
      p50: sorted[p50Index],
      p95: sorted[p95Index],
      p99: sorted[p99Index],
      recentSamples: samples.slice(-maxRecent),
    };
  }

  // --- API Latency Recording ---
  public recordApiRequest(endpoint: string, durationMs: number, statusCode: number = 200): void {
    this.apiTotalRequests++;
    const isError = statusCode >= 400;
    if (isError) this.apiErrorRequests++;

    this.apiLatencies.push(durationMs);
    if (this.apiLatencies.length > 1000) this.apiLatencies.shift();

    const existing = this.apiEndpoints.get(endpoint) || { requests: 0, errors: 0, totalMs: 0 };
    existing.requests++;
    if (isError) existing.errors++;
    existing.totalMs += durationMs;
    this.apiEndpoints.set(endpoint, existing);
  }

  // --- Decision Engine Latency Recording ---
  public recordDecisionLatency(durationMs: number, rulesEvaluated: number = 1, actionsEmitted: number = 0): void {
    this.decisionEvaluations++;
    this.decisionRulesEvaluated += rulesEvaluated;
    this.decisionActionsEmitted += actionsEmitted;
    this.decisionLatencies.push(durationMs);
    if (this.decisionLatencies.length > 1000) this.decisionLatencies.shift();
  }

  // --- Allocation Engine Latency Recording ---
  public recordAllocationLatency(durationMs: number, tasksShifted: number = 0): void {
    this.allocationCount++;
    this.tasksShiftedCount += tasksShifted;
    this.allocationLatencies.push(durationMs);
    if (this.allocationLatencies.length > 1000) this.allocationLatencies.shift();
  }

  // --- Background Job Execution Recording ---
  public recordSchedulerTick(durationMs: number): void {
    this.backgroundTicks++;
    this.lastTickDurationMs = durationMs;
  }

  public recordJobExecution(jobType: string, durationMs: number, success: boolean): void {
    this.backgroundJobsExecuted++;
    if (success) {
      this.backgroundJobsSucceeded++;
    } else {
      this.backgroundJobsFailed++;
    }

    const existing = this.backgroundJobTypes.get(jobType) || { count: 0, failures: 0, totalDurationMs: 0 };
    existing.count++;
    if (!success) existing.failures++;
    existing.totalDurationMs += durationMs;
    this.backgroundJobTypes.set(jobType, existing);
  }

  // --- Event Processing Metrics ---
  public recordEventDispatched(durationMs: number = 1, persisted: boolean = true): void {
    this.eventsDispatched++;
    if (persisted) this.eventsPersisted++;
    this.totalDispatchMs += durationMs;
  }

  public recordUpcastingLatency(durationMs: number): void {
    this.upcastingLatencies.push(durationMs);
    if (this.upcastingLatencies.length > 500) this.upcastingLatencies.shift();
  }

  public setDeadLetterCount(count: number): void {
    this.deadLetterCount = count;
  }

  // --- Error Categorization ---
  public recordError(category: string, error?: Error | any): void {
    this.totalErrors++;
    const current = this.categorizedErrors.get(category) || 0;
    this.categorizedErrors.set(category, current + 1);
  }

  public recordUnhandledException(): void {
    this.unhandledExceptions++;
    this.recordError('UNHANDLED_EXCEPTION');
  }

  // --- Autonomous Resolution Metrics ---
  public recordSelfHealingEvent(type: string = 'SCHEDULE_SELF_HEAL'): void {
    this.selfHealingEvents++;
  }

  public recordAutoAppliedProposal(): void {
    this.autoAppliedProposals++;
  }

  public recordGatedProposal(): void {
    this.gatedProposals++;
  }

  public recordAutonomousFallback(): void {
    this.autonomousFallbacks++;
  }

  // --- Governance Metrics ---
  public recordGovernanceApproval(tier: 'TIER_1' | 'TIER_2' | 'TIER_3'): void {
    if (tier === 'TIER_1') this.tier1Approvals++;
    else if (tier === 'TIER_2') this.tier2Approvals++;
    else if (tier === 'TIER_3') this.tier3Approvals++;
  }

  public recordUnauthorizedVeto(): void {
    this.unauthorizedVetoes++;
  }

  public recordAutonomyPausedRejection(): void {
    this.autonomyPausedRejections++;
  }

  // --- Metric Snapshot Generation ---
  public getSnapshot(): OperationalMetricsSnapshot {
    const uptimeSeconds = Math.max(1, Math.floor((Date.now() - this.startTime) / 1000));
    const errorRatePercent = this.apiTotalRequests > 0
      ? Math.round((this.apiErrorRequests / this.apiTotalRequests) * 1000) / 10
      : 0;

    const endpointObj: Record<string, { requests: number; errors: number; avgLatencyMs: number }> = {};
    this.apiEndpoints.forEach((v, k) => {
      endpointObj[k] = {
        requests: v.requests,
        errors: v.errors,
        avgLatencyMs: v.requests > 0 ? Math.round((v.totalMs / v.requests) * 10) / 10 : 0,
      };
    });

    const jobTypesObj: Record<string, { count: number; failures: number; avgDurationMs: number }> = {};
    this.backgroundJobTypes.forEach((v, k) => {
      jobTypesObj[k] = {
        count: v.count,
        failures: v.failures,
        avgDurationMs: v.count > 0 ? Math.round((v.totalDurationMs / v.count) * 10) / 10 : 0,
      };
    });

    const catErrorsObj: Record<string, number> = {};
    this.categorizedErrors.forEach((v, k) => {
      catErrorsObj[k] = v;
    });

    const totalAutonomousEvents = this.selfHealingEvents + this.autoAppliedProposals + this.autonomousFallbacks;
    const totalGatedOrManual = this.gatedProposals + this.unauthorizedVetoes;
    const totalDecisions = totalAutonomousEvents + totalGatedOrManual;
    const autonomousResolutionRatePercent = totalDecisions > 0
      ? Math.round((totalAutonomousEvents / totalDecisions) * 100)
      : 100;

    const dispatchRatePerSec = uptimeSeconds > 0
      ? Math.round((this.eventsDispatched / uptimeSeconds) * 100) / 100
      : 0;

    const avgDispatchLatencyMs = this.eventsDispatched > 0
      ? Math.round((this.totalDispatchMs / this.eventsDispatched) * 10) / 10
      : 0;

    const throughputPerMinute = Math.round((this.backgroundJobsExecuted / (uptimeSeconds / 60)) * 10) / 10;

    return {
      timestamp: new Date().toISOString(),
      uptimeSeconds,
      api: {
        totalRequests: this.apiTotalRequests,
        errorCount: this.apiErrorRequests,
        errorRatePercent,
        latency: this.calculateHistogram(this.apiLatencies),
        endpoints: endpointObj,
      },
      decision: {
        evaluationsCount: this.decisionEvaluations,
        rulesEvaluatedCount: this.decisionRulesEvaluated,
        actionsEmittedCount: this.decisionActionsEmitted,
        latency: this.calculateHistogram(this.decisionLatencies),
      },
      allocation: {
        reallocationsCount: this.allocationCount,
        tasksShiftedCount: this.tasksShiftedCount,
        latency: this.calculateHistogram(this.allocationLatencies),
      },
      backgroundJobs: {
        totalTicks: this.backgroundTicks,
        jobsExecuted: this.backgroundJobsExecuted,
        jobsSucceeded: this.backgroundJobsSucceeded,
        jobsFailed: this.backgroundJobsFailed,
        throughputPerMinute,
        lastTickDurationMs: this.lastTickDurationMs,
        jobTypes: jobTypesObj,
      },
      eventProcessing: {
        eventsDispatched: this.eventsDispatched,
        eventsPersisted: this.eventsPersisted,
        dispatchRatePerSec,
        avgDispatchLatencyMs,
        deadLetterQueueCount: this.deadLetterCount,
        upcastingLatency: this.calculateHistogram(this.upcastingLatencies),
      },
      errors: {
        totalErrors: this.totalErrors,
        unhandledExceptions: this.unhandledExceptions,
        categorizedErrors: catErrorsObj,
      },
      autonomousResolution: {
        selfHealingEventsCount: this.selfHealingEvents,
        autoAppliedProposalsCount: this.autoAppliedProposals,
        gatedProposalsCount: this.gatedProposals,
        autonomousFallbacksTriggered: this.autonomousFallbacks,
        autonomousResolutionRatePercent,
      },
      governance: {
        tier1ApprovalsCount: this.tier1Approvals,
        tier2ApprovalsCount: this.tier2Approvals,
        tier3ApprovalsCount: this.tier3Approvals,
        unauthorizedAttemptsVetoed: this.unauthorizedVetoes,
        autonomyPausedRejections: this.autonomyPausedRejections,
      },
    };
  }

  public reset(): void {
    this.startTime = Date.now();
    this.apiLatencies = [];
    this.decisionLatencies = [];
    this.allocationLatencies = [];
    this.upcastingLatencies = [];
    this.apiTotalRequests = 0;
    this.apiErrorRequests = 0;
    this.apiEndpoints.clear();
    this.decisionEvaluations = 0;
    this.decisionRulesEvaluated = 0;
    this.decisionActionsEmitted = 0;
    this.allocationCount = 0;
    this.tasksShiftedCount = 0;
    this.backgroundTicks = 0;
    this.backgroundJobsExecuted = 0;
    this.backgroundJobsSucceeded = 0;
    this.backgroundJobsFailed = 0;
    this.backgroundJobTypes.clear();
    this.eventsDispatched = 0;
    this.eventsPersisted = 0;
    this.totalDispatchMs = 0;
    this.deadLetterCount = 0;
    this.totalErrors = 0;
    this.unhandledExceptions = 0;
    this.categorizedErrors.clear();
    this.selfHealingEvents = 0;
    this.autoAppliedProposals = 0;
    this.gatedProposals = 0;
    this.autonomousFallbacks = 0;
    this.tier1Approvals = 0;
    this.tier2Approvals = 0;
    this.tier3Approvals = 0;
    this.unauthorizedVetoes = 0;
    this.autonomyPausedRejections = 0;
  }
}

export const defaultMetrics = MetricsService.getInstance();
