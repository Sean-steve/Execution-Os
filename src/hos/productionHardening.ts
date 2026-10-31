import path from 'path';
import { Express, NextFunction, Request, Response } from 'express';
import { RateLimiter } from '../server/rateLimiter';
import { defaultMetrics } from '../services/metricsService';
import { defaultObservability } from '../services/observabilityService';
import { HOS_ENGINE_MANIFEST } from './engineManifest';

export interface HOSProductionRuntimeValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface HOSReadinessSnapshot {
  status: 'ready' | 'not_ready';
  engineId: string;
  engineVersion: string;
  contractVersion: string;
  identityAuthority: 'HumanKernelOS';
  scheduleAuthority: 'HumanKernelOS';
  checks: {
    productionConfig: boolean;
    identityMode: boolean;
    eventMeshTransport: boolean;
    runtimeStorageIsolation: boolean;
  };
  errors: string[];
  warnings: string[];
  timestamp: string;
}

function isPathInside(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function validateHOSProductionRuntime(): HOSProductionRuntimeValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (process.env.NODE_ENV !== 'production') {
    return { valid: true, errors, warnings };
  }

  const identityMode = process.env.EXECUTION_OS_IDENTITY_MODE === 'LEGACY_STANDALONE'
    ? 'LEGACY_STANDALONE'
    : 'HOS';

  if (identityMode !== 'HOS') {
    warnings.push('Execution OS is running in explicit legacy standalone compatibility mode; HOS integration readiness is not active.');
    return { valid: true, errors, warnings };
  }

  const eventMeshUrl = process.env.HOS_EVENT_MESH_URL?.trim();
  if (!eventMeshUrl) {
    errors.push('HOS_EVENT_MESH_URL is required in production HOS identity mode.');
  } else {
    try {
      const parsed = new URL(eventMeshUrl);
      if (parsed.protocol !== 'https:') {
        errors.push('HOS_EVENT_MESH_URL must use HTTPS in production.');
      }
      if (!parsed.hostname) {
        errors.push('HOS_EVENT_MESH_URL must include a valid hostname.');
      }
    } catch {
      errors.push('HOS_EVENT_MESH_URL must be a valid absolute URL.');
    }
  }

  const cwd = process.cwd();
  const sourceDir = path.resolve(cwd, 'src');
  const boundaryPath = path.resolve(
    process.env.HOS_BOUNDARY_STORE_PATH || path.join(cwd, 'data', 'hos_boundary_store.json')
  );
  const subjectDir = path.resolve(
    process.env.EXECUTION_OS_SUBJECT_DATA_DIR || path.join(cwd, 'data', 'subjects')
  );
  const dlqPath = path.resolve(
    process.env.HEE_DLQ_PATH || path.join(cwd, 'data', 'dead_letter_queue.json')
  );

  if (isPathInside(boundaryPath, sourceDir) || isPathInside(subjectDir, sourceDir) || isPathInside(dlqPath, sourceDir)) {
    errors.push('Production runtime state must not be stored inside the source tree.');
  }

  if (boundaryPath === subjectDir || boundaryPath === dlqPath) {
    errors.push('HOS boundary, subject-state, and dead-letter storage locations must be distinct.');
  }

  const timeoutMs = positiveInteger(process.env.HOS_EVENT_MESH_TIMEOUT_MS, 5000);
  if (timeoutMs > 30000) {
    warnings.push('HOS_EVENT_MESH_TIMEOUT_MS is above 30 seconds; production failover may be slower than intended.');
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function getHOSReadinessSnapshot(): HOSReadinessSnapshot {
  const validation = validateHOSProductionRuntime();
  const identityMode = process.env.EXECUTION_OS_IDENTITY_MODE === 'LEGACY_STANDALONE'
    ? 'LEGACY_STANDALONE'
    : 'HOS';

  let transportSecure = process.env.NODE_ENV !== 'production';
  const url = process.env.HOS_EVENT_MESH_URL?.trim();
  if (url) {
    try {
      transportSecure = new URL(url).protocol === 'https:';
    } catch {
      transportSecure = false;
    }
  } else if (process.env.NODE_ENV === 'production' && identityMode === 'HOS') {
    transportSecure = false;
  }

  const storageIsolated = !validation.errors.some(error =>
    /runtime state|storage locations/i.test(error)
  );

  const ready = validation.valid && (identityMode === 'HOS' || process.env.NODE_ENV !== 'production');

  return {
    status: ready ? 'ready' : 'not_ready',
    engineId: HOS_ENGINE_MANIFEST.engineId,
    engineVersion: HOS_ENGINE_MANIFEST.engineVersion,
    contractVersion: HOS_ENGINE_MANIFEST.contractVersion,
    identityAuthority: 'HumanKernelOS',
    scheduleAuthority: 'HumanKernelOS',
    checks: {
      productionConfig: validation.valid,
      identityMode: identityMode === 'HOS',
      eventMeshTransport: transportSecure,
      runtimeStorageIsolation: storageIsolated,
    },
    errors: validation.errors,
    warnings: validation.warnings,
    timestamp: new Date().toISOString(),
  };
}

export function installApiProductionHardening(app: Express): void {
  app.disable('x-powered-by');

  app.use((req: Request, res: Response, next: NextFunction) => {
    const startedAt = Date.now();

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');

    if (req.path.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Pragma', 'no-cache');
    }

    res.on('finish', () => {
      const durationMs = Date.now() - startedAt;
      defaultMetrics.recordApiRequest(`${req.method} ${req.path}`, durationMs, res.statusCode);
      if (res.statusCode >= 500) {
        defaultObservability.error(
          'ExecutionOSApi',
          'Request completed with server error',
          undefined,
          { method: req.method, path: req.path, statusCode: res.statusCode, durationMs },
          { requestId: req.requestId }
        );
      }
    });

    next();
  });
}

export function createHOSRateLimitMiddleware() {
  const limiter = new RateLimiter();
  const windowMs = positiveInteger(process.env.HOS_RATE_LIMIT_WINDOW_MS, 60000);
  const maxRequests = positiveInteger(process.env.HOS_RATE_LIMIT_MAX_REQUESTS, 120);

  return limiter.createMiddleware({
    windowMs,
    maxRequests,
    keyGenerator: req => {
      if (req.hosSubject) return `${req.hosSubject.tenantId}::${req.hosSubject.subjectId}`;
      if (req.user) return `${req.user.tenantId}::${req.user.userId}`;
      return req.ip || 'anonymous';
    },
  });
}
