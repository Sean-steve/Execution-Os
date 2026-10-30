import { defaultObservability, ObservabilityService } from './observabilityService';

export interface TraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  operationName: string;
  serviceName: string;
  startTimeMs: number;
  endTimeMs?: number;
  durationMs?: number;
  status: 'OK' | 'ERROR';
  tags: Record<string, any>;
  logs: Array<{ timestamp: string; message: string; data?: any }>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

export interface TraceWaterfall {
  traceId: string;
  rootOperation: string;
  startTimeMs: number;
  totalDurationMs: number;
  spans: TraceSpan[];
  status: 'OK' | 'ERROR';
}

export class TracingService {
  private static instance: TracingService;
  private spans: TraceSpan[] = [];
  private activeSpans: Map<string, TraceSpan> = new Map();
  private maxBufferSize: number = 500;
  private obs: ObservabilityService;

  constructor(obs: ObservabilityService = defaultObservability, maxBufferSize: number = 500) {
    this.obs = obs;
    this.maxBufferSize = maxBufferSize;
  }

  public static getInstance(): TracingService {
    if (!TracingService.instance) {
      TracingService.instance = new TracingService();
    }
    return TracingService.instance;
  }

  public startTrace(operationName: string, serviceName: string = 'ExecutionOS', tags: Record<string, any> = {}): TraceSpan {
    const traceId = this.obs.generateTraceId('trc');
    const spanId = this.obs.generateSpanId('spn-root');
    this.obs.setCurrentTraceId(traceId);

    const span: TraceSpan = {
      traceId,
      spanId,
      operationName,
      serviceName,
      startTimeMs: Date.now(),
      status: 'OK',
      tags: { ...tags, isRoot: true },
      logs: [{ timestamp: new Date().toISOString(), message: `Trace started: ${operationName}` }],
    };

    this.activeSpans.set(spanId, span);
    this.obs.debug(serviceName, `[Trace:Start] ${operationName}`, { traceId, spanId, ...tags }, { traceId, spanId });
    return span;
  }

  public startSpan(operationName: string, parentSpan: TraceSpan, serviceName?: string, tags: Record<string, any> = {}): TraceSpan {
    const spanId = this.obs.generateSpanId('spn');
    const span: TraceSpan = {
      traceId: parentSpan.traceId,
      spanId,
      parentSpanId: parentSpan.spanId,
      operationName,
      serviceName: serviceName || parentSpan.serviceName,
      startTimeMs: Date.now(),
      status: 'OK',
      tags,
      logs: [{ timestamp: new Date().toISOString(), message: `Span started: ${operationName}` }],
    };

    this.activeSpans.set(spanId, span);
    return span;
  }

  public logEventToSpan(span: TraceSpan, message: string, data?: any): void {
    span.logs.push({
      timestamp: new Date().toISOString(),
      message,
      data,
    });
  }

  public finishSpan(span: TraceSpan, status: 'OK' | 'ERROR' = 'OK', error?: Error | any): TraceSpan {
    span.endTimeMs = Date.now();
    span.durationMs = span.endTimeMs - span.startTimeMs;
    span.status = status;

    if (error) {
      span.error = {
        name: error.name || 'Error',
        message: error.message || String(error),
        stack: error.stack,
      };
      this.obs.error(
        span.serviceName,
        `[Span:Fail] ${span.operationName} failed in ${span.durationMs}ms: ${error.message}`,
        error,
        { durationMs: span.durationMs, ...span.tags },
        { traceId: span.traceId, spanId: span.spanId, parentSpanId: span.parentSpanId }
      );
    } else {
      this.obs.debug(
        span.serviceName,
        `[Span:Complete] ${span.operationName} finished in ${span.durationMs}ms`,
        { durationMs: span.durationMs, ...span.tags },
        { traceId: span.traceId, spanId: span.spanId, parentSpanId: span.parentSpanId }
      );
    }

    this.activeSpans.delete(span.spanId);
    this.spans.unshift(span);
    if (this.spans.length > this.maxBufferSize) {
      this.spans.pop();
    }

    return span;
  }

  public async traceAsync<T>(
    operationName: string,
    serviceName: string,
    fn: (span: TraceSpan) => Promise<T>,
    parentSpan?: TraceSpan,
    tags: Record<string, any> = {}
  ): Promise<T> {
    const span = parentSpan
      ? this.startSpan(operationName, parentSpan, serviceName, tags)
      : this.startTrace(operationName, serviceName, tags);

    try {
      const result = await fn(span);
      this.finishSpan(span, 'OK');
      return result;
    } catch (err: any) {
      this.finishSpan(span, 'ERROR', err);
      throw err;
    }
  }

  public getTraceWaterfall(traceId: string): TraceWaterfall | null {
    const traceSpans = this.spans.filter(s => s.traceId === traceId);
    if (traceSpans.length === 0) return null;

    const rootSpan = traceSpans.find(s => !s.parentSpanId) || traceSpans[traceSpans.length - 1];
    const startTimeMs = Math.min(...traceSpans.map(s => s.startTimeMs));
    const endTimeMs = Math.max(...traceSpans.map(s => s.endTimeMs || s.startTimeMs));

    return {
      traceId,
      rootOperation: rootSpan.operationName,
      startTimeMs,
      totalDurationMs: Math.max(0, endTimeMs - startTimeMs),
      spans: traceSpans.sort((a, b) => a.startTimeMs - b.startTimeMs),
      status: traceSpans.some(s => s.status === 'ERROR') ? 'ERROR' : 'OK',
    };
  }

  public getRecentTraces(limit: number = 20): TraceWaterfall[] {
    const traceIds = Array.from(new Set(this.spans.map(s => s.traceId))).slice(0, limit);
    return traceIds
      .map(id => this.getTraceWaterfall(id))
      .filter((w): w is TraceWaterfall => w !== null);
  }

  public clear(): void {
    this.spans = [];
    this.activeSpans.clear();
  }
}

export const defaultTracing = TracingService.getInstance();
