import path from 'path';
import express from 'express';
import { createApp } from './src/server/createApp';
import { defaultBackgroundWorker } from './src/services/backgroundWorker';
import { getExecutionIdentityMode } from './src/server/auth';
import { createServer as createViteServer } from 'vite';
import { assertPostgresRuntimeReady, getExecutionPersistenceMode } from './src/canonical/postgresCanonicalStorageEngine';
import { HOSSubjectScopedRepositoryFactory } from './src/hos/repositoryFactory';
import { defaultHOSEngineLifecycleRegistry } from './src/hos/lifecycle';
import { defaultHOSBoundaryStore } from './src/hos/boundaryStore';
import { HOSSubjectRuntimeRegistry } from './src/hos/runtimeRegistry';

async function startServer() {
  const identityMode = getExecutionIdentityMode();
  const persistenceMode = getExecutionPersistenceMode();

  await assertPostgresRuntimeReady();

  const hosRepositories = new HOSSubjectScopedRepositoryFactory(undefined, persistenceMode);
  const hosRuntime = new HOSSubjectRuntimeRegistry(
    hosRepositories,
    defaultHOSEngineLifecycleRegistry,
    defaultHOSBoundaryStore
  );
  const app = createApp({
    hosRepositoryFactory: hosRepositories,
    hosLifecycle: defaultHOSEngineLifecycleRegistry,
    hosBoundaryStore: defaultHOSBoundaryStore,
    hosRuntimeRegistry: hosRuntime,
  });
  const PORT = Number.parseInt(process.env.PORT || '3000', 10);

  if (identityMode === 'LEGACY_STANDALONE') {
    defaultBackgroundWorker.start();
  } else {
    const restored = await hosRuntime.restoreActiveWorkers();
    if (restored > 0) {
      console.log(`[Execution OS] Restored ${restored} active HOS subject runtime worker(s).`);
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `Execution OS Backend Service running on port ${PORT} in ${identityMode} identity mode with ${persistenceMode} persistence`
    );
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Execution OS] Received ${signal}; stopping new work and shutting down cleanly.`);
    defaultBackgroundWorker.stop();
    hosRuntime.shutdown();

    const forceExit = setTimeout(() => {
      console.error('[Execution OS] Graceful shutdown deadline exceeded.');
      process.exit(1);
    }, 10000);
    forceExit.unref();

    server.close(error => {
      clearTimeout(forceExit);
      if (error) {
        console.error('[Execution OS] HTTP server shutdown failed:', error);
        process.exitCode = 1;
      }
    });
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

startServer().catch(error => {
  console.error('[Execution OS] Startup failed:', error);
  defaultBackgroundWorker.stop();
  process.exitCode = 1;
});
