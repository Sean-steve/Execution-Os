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

export interface AppOptions {
  repository?: IExecutionRepository;
  clock?: IClock;
  validateSecurityConfig?: boolean;
  hosRepositoryFactory?: IHOSRepositoryFactory;
  hosEventMesh?: HOSEventMeshBridge;
  hosLifecycle?: HOSEngineLifecycleRegistry;
}

export function createApp(options: AppOptions = {}): Express {
  if (options.validateSecurityConfig || process.env.NODE_ENV === 'production') {
    const check = SecurityEngine.validateProductionConfig();
    if (!check.valid) {
      throw new Error(`[Execution OS Startup] Production configuration invalid: ${check.message}`);
    }
  }

  const app = express();
  const repository = options.repository || defaultExecutionRepository;

  // 1. Core middlewares
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  // 2. Request ID & Timing metadata
  app.use((req: Request, res: Response, next: NextFunction) => {
    const reqId = (req.headers['x-request-id'] as string) || `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    req.requestId = reqId;
    res.setHeader('X-Request-ID', reqId);
    next();
  });

  // 3. Authentication & User Context
  app.use(authMiddleware);

  // 4. API Healthcheck
  app.get('/api/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', service: 'Execution OS Backend', timestamp: new Date().toISOString() });
  });

  // 5. HumanKernelOS engine adapter
  const hosRouter = createHOSRouter(
    options.hosRepositoryFactory || new HOSSubjectScopedRepositoryFactory(),
    options.hosEventMesh || defaultHOSEventMeshBridge,
    options.hosLifecycle || defaultHOSEngineLifecycleRegistry
  );
  app.use('/api/v1/hos', hosRouter);

  // 6. Versioned Execution OS legacy/internal APIs
  const heeRouter = createHeeRouter(repository, options.clock);
  app.use('/api/v1/hee', heeRouter);

  // 7. Global Structured Error Handler (EOS-004 Error Contract)
  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    const requestId = req.requestId;

    if (err instanceof ApiError) {
      res.status(err.statusCode).json(err.toJSON(requestId));
      return;
    }

    // Default unhandled errors mapped to INTERNAL_ERROR
    const internalErr = new InternalError(err?.message || 'An unexpected internal error occurred', {
      stack: process.env.NODE_ENV === 'test' ? undefined : err?.stack,
    });
    res.status(internalErr.statusCode).json(internalErr.toJSON(requestId));
  });

  return app;
}
