import { config } from 'dotenv';
config({ path: '.env.local' });
config();
import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from './server/app';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true, host: '0.0.0.0' }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('/{*path}', (_req, res) => { res.sendFile(path.resolve(__dirname, 'dist/index.html')); });
  }
  app.listen(PORT, '0.0.0.0', () => console.log(`Server: http://localhost:${PORT} (Supabase)`));
}
startServer().catch(err => { console.error(err); process.exit(1); });
