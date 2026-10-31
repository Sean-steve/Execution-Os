import path from 'path';
import express from 'express';
import { createApp } from './src/server/createApp';
import { defaultBackgroundWorker } from './src/services/backgroundWorker';
import { getExecutionIdentityMode } from './src/server/auth';
import { createServer as createViteServer } from 'vite';

async function startServer() {
  const app = createApp();
  const PORT = Number.parseInt(process.env.PORT || '3000', 10);
  const identityMode = getExecutionIdentityMode();

  // A global standalone worker has no HOS subject/tenant context and therefore
  // must never become an execution authority in HOS mode.
  if (identityMode === 'LEGACY_STANDALONE') {
    defaultBackgroundWorker.start();
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
    console.log(`Execution OS Backend Service running on port ${PORT} in ${identityMode} identity mode`);
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Execution OS] Received ${signal}; stopping new work and shutting down cleanly.`);
    defaultBackgroundWorker.stop();

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
