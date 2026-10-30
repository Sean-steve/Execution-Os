import path from 'path';
import express from 'express';
import { createApp } from './src/server/createApp';
import { defaultBackgroundWorker } from './src/services/backgroundWorker';
import { createServer as createViteServer } from 'vite';

async function startServer() {
  const app = createApp();
  const PORT = 3000;

  // Start background worker for 24/7 governed execution
  defaultBackgroundWorker.start();

  // Vite middleware for development / static serving for production
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Execution OS Backend Service running on http://localhost:${PORT}`);
  });
}

startServer();
