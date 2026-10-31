import express, { Express, Request, Response, NextFunction } from 'express';
import { IExecutionRepository, defaultExecutionRepository } from '../repositories';
import { IClock } from '../clock';
import { authMiddleware } from './auth';
import { createHeeRouter } from './routes/heeRouter';
import { createHOSRouter } from './routes/hosRouter';
import { IHOSRepositoryFactory, HOSSubjectScopedRepositoryFactory } from '../hos/repositoryFactory';
import { HOSEventMeshBridge, defaultHOSEventMeshBridge } from '../hos/eventMesh';
import { HOSEngineLifecycleRegistry, defaultHOSEngineLifecycleRegistry } from '../hos/lifecycle';
import { ApiError, InternalError } from './errors';
import { SecurityEngine } from './security';
import { IHOSBoundaryStore, defaultHOSBoundaryStore } from '../hos/boundaryStore';
import {
  createHOSRateLimitMiddleware,
  installApiProductionHardening,
  validateHOSProductionRuntime,
} from '../hos/productionHardening';
import { defaultMetrics } from '../services/metricsService';
import { defaultObservability } from '../services/observabilityService';

export interface AppOptions {
  repository?: IExecutionRepository;
  clock?: IClock;
  validateSecurityConfig?: boolean;
  hosRepositoryFactory?: IHOSRepositoryFactory;
  hosEventMesh?: HOSEventMeshBridge;
  hosLifecycle?: HOSEngineLifecycleRegistry;
  hosBoundaryStore?: IHOSBoundaryStore;
}

function requestIdFrom(req: Request): string {
  const supplied = String(req.headers['x-request-id'] || '').trim();
  if (/^[A-Za-z0-9._:-]{8,128}$/.test(supplied)) return supplied;
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 12)}`;
}

export function createApp(options: AppOptions = {}): Express {
  if (options.validateSecurityConfig || process.env.NODE_ENV === 'production') {
    const securityCheck = SecurityEngine.validateProductionConfig();
    if (!securityCheck.valid) {
      throw new Error(`[Execution OS Startup] Production security configuration invalid: ${securityCheck.message}`);
    }

    const hosCheck = validateHOSProductionRuntime();
    if (!hosCheck.valid) {
      throw new Error(`[Execution OS Startup] HOS production readiness invalid: ${hosCheck.errors.join(' ')}`);
    }
  }

  const app = express();
  const repository = options.repository || defaultExecutionRepository;

  // 1. Base production hardening, telemetry and payload bounds
  installApiProductionHardening(app);
  app.use(express.json({ limit: process.env.EXECUTION_OS_MAX_JSON_BODY || '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: process.env.EXECUTION_OS_MAX_JSON_BODY || '1mb' }));

  // 2. Request correlation metadata with bounded/sanitized caller-provided IDs
  app.use((req: Request, res: Response, next: NextFunction) => {
    const reqId = requestIdFrom(req);
    req.requestId = reqId;
    res.setHeader('X-Request-ID', reqId);
    next();
  });

  // 3. Authentication & HOS subject binding
  app.use(authMiddleware);

  // 4. HOS boundary abuse protection. Public HOS health/manifest paths are
  // rate-limited by network identity; authenticated calls are scoped by tenant+subject.
  app.use('/api/v1/hos', createHOSRateLimitMiddleware());

  // 5. Process liveness. Integration readiness is exposed separately by the HOS router.
  app.get('/api/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      service: 'Execution OS Backend',
      timestamp: new Date().toISOString(),
    });
  });

  // 6. HumanKernelOS engine adapter
  const hosRouter = createHOSRouter(
    options.hosRepositoryFactory || new HOSSubjectScopedRepositoryFactory(),
    options.hosEventMesh || defaultHOSEventMeshBridge,
    options.hosLifecycle || defaultHOSEngineLifecycleRegistry,
    options.hosBoundaryStore || defaultHOSBoundaryStore
  );
  app.use('/api/v1/hos', hosRouter);

  // 7. Versioned Execution OS legacy/internal APIs
  const heeRouter = createHeeRouter(repository, options.clock);
  app.use('/api/v1/hee', heeRouter);

  // 8. Global structured error handler. Production clients never receive
  // stack traces or raw unhandled exception messages.
  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    const requestId = req.requestId;

    if (err instanceof ApiError) {
      res.status(err.statusCode).json(err.toJSON(requestId));
      return;
    }

    defaultMetrics.recordUnhandledException();
    defaultObservability.error(
      'ExecutionOSApi',
      'Unhandled request exception',
      err instanceof Error ? err : new Error(String(err)),
      { method: req.method, path: req.path },
      { requestId }
    );

    const clientMessage = process.env.NODE_ENV === 'production'
      ? 'An unexpected internal error occurred'
      : (err?.message || 'An unexpected internal error occurred');
    const internalErr = new InternalError(clientMessage);
    res.status(internalErr.statusCode).json(internalErr.toJSON(requestId));
  });

  return app;
}
