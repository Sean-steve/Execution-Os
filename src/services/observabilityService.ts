export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

export interface CorrelationContext {
  traceId: string;
  spanId?: string;
  parentSpanId?: string;
  causationId?: string;
  requestId?: string;
  userId?: string;
  deviceId?: string;
  taskId?: string;
  proposalId?: string;
  action?: string;
}

export interface StructuredLogEntry {
  id: string;
  timestamp: string; // ISO 8601 UTC
  level: LogLevel;
  service: string;
  message: string;
  correlation: CorrelationContext;
  metadata?: Record<string, any>;
  error?: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
  };
}

export interface LogFilterOptions {
  level?: LogLevel;
  minLevel?: LogLevel;
  service?: string;
  traceId?: string;
  searchQuery?: string;
  limit?: number;
  fromTime?: string;
  toTime?: string;
}

const LEVEL_SEVERITY: Record<LogLevel, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
  FATAL: 50,
};

export class ObservabilityService {
  private static instance: ObservabilityService;
  private logs: StructuredLogEntry[] = [];
  private maxBufferSize: number = 1000;
  private currentTraceId: string = 'root-trace-001';

  constructor(maxBufferSize: number = 1000) {
    this.maxBufferSize = maxBufferSize;
  }

  public static getInstance(): ObservabilityService {
    if (!ObservabilityService.instance) {
      ObservabilityService.instance = new ObservabilityService();
    }
    return ObservabilityService.instance;
  }

  public generateTraceId(prefix: string = 'trc'): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  public generateSpanId(prefix: string = 'spn'): string {
    return `${prefix}-${Math.random().toString(36).substring(2, 9)}`;
  }

  public setCurrentTraceId(traceId: string): void {
    this.currentTraceId = traceId;
  }

  public getCurrentTraceId(): string {
    return this.currentTraceId;
  }

  public log(
    level: LogLevel,
    service: string,
    message: string,
    correlation?: Partial<CorrelationContext>,
    metadata?: Record<string, any>,
    error?: Error | { name: string; message: string; stack?: string; code?: string }
  ): StructuredLogEntry {
    const entry: StructuredLogEntry = {
      id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      level,
      service,
      message,
      correlation: {
        traceId: correlation?.traceId || this.currentTraceId || this.generateTraceId(),
        spanId: correlation?.spanId || this.generateSpanId(),
        parentSpanId: correlation?.parentSpanId,
        causationId: correlation?.causationId,
        requestId: correlation?.requestId,
        userId: correlation?.userId || 'user-default',
        deviceId: correlation?.deviceId || 'local-host',
        taskId: correlation?.taskId,
        proposalId: correlation?.proposalId,
        action: correlation?.action,
      },
      metadata,
      error: error
        ? {
            name: error.name || 'Error',
            message: error.message,
            stack: error.stack,
            code: (error as any).code || 'ERR_EXECUTION_OS',
          }
        : undefined,
    };

    this.logs.unshift(entry);
    if (this.logs.length > this.maxBufferSize) {
      this.logs.pop();
    }

    return entry;
  }

  public debug(service: string, message: string, metadata?: Record<string, any>, correlation?: Partial<CorrelationContext>): StructuredLogEntry {
    return this.log('DEBUG', service, message, correlation, metadata);
  }

  public info(service: string, message: string, metadata?: Record<string, any>, correlation?: Partial<CorrelationContext>): StructuredLogEntry {
    return this.log('INFO', service, message, correlation, metadata);
  }

  public warn(service: string, message: string, metadata?: Record<string, any>, correlation?: Partial<CorrelationContext>): StructuredLogEntry {
    return this.log('WARN', service, message, correlation, metadata);
  }

  public error(
    service: string,
    message: string,
    error?: Error | any,
    metadata?: Record<string, any>,
    correlation?: Partial<CorrelationContext>
  ): StructuredLogEntry {
    return this.log('ERROR', service, message, correlation, metadata, error);
  }

  public fatal(
    service: string,
    message: string,
    error?: Error | any,
    metadata?: Record<string, any>,
    correlation?: Partial<CorrelationContext>
  ): StructuredLogEntry {
    return this.log('FATAL', service, message, correlation, metadata, error);
  }

  public query(options: LogFilterOptions = {}): StructuredLogEntry[] {
    let result = [...this.logs];

    if (options.level) {
      result = result.filter(l => l.level === options.level);
    }
    if (options.minLevel) {
      const minSev = LEVEL_SEVERITY[options.minLevel];
      result = result.filter(l => LEVEL_SEVERITY[l.level] >= minSev);
    }
    if (options.service) {
      const s = options.service.toLowerCase();
      result = result.filter(l => l.service.toLowerCase().includes(s));
    }
    if (options.traceId) {
      result = result.filter(l => l.correlation.traceId === options.traceId);
    }
    if (options.searchQuery) {
      const q = options.searchQuery.toLowerCase();
      result = result.filter(l => 
        l.message.toLowerCase().includes(q) ||
        l.service.toLowerCase().includes(q) ||
        l.correlation.traceId.toLowerCase().includes(q) ||
        (l.error && l.error.message.toLowerCase().includes(q))
      );
    }
    if (options.fromTime) {
      const from = new Date(options.fromTime).getTime();
      result = result.filter(l => new Date(l.timestamp).getTime() >= from);
    }
    if (options.toTime) {
      const to = new Date(options.toTime).getTime();
      result = result.filter(l => new Date(l.timestamp).getTime() <= to);
    }

    if (options.limit && options.limit > 0) {
      result = result.slice(0, options.limit);
    }

    return result;
  }

  public getRecentLogs(count: number = 50): StructuredLogEntry[] {
    return this.logs.slice(0, count);
  }

  public clear(): void {
    this.logs = [];
  }

  public exportNdjson(): string {
    return this.logs.map(l => JSON.stringify(l)).join('\n');
  }

  public exportJson(): string {
    return JSON.stringify(this.logs, null, 2);
  }
}

export const defaultObservability = ObservabilityService.getInstance();
