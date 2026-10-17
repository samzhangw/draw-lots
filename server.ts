import { config } from 'dotenv';
config({ path: '.env.local' });
config();
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from './server/app';
import { serveFrontend } from './server/frontendAssets';
import { startSessionCleanup } from './server/sessionCleanup';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
// Direct execution also defaults to production, including secure session cookies.
const development = process.env.NODE_ENV === 'development';
process.env.NODE_ENV = development ? 'development' : 'production';
const HOST = process.env.HOST || (development ? '127.0.0.1' : '0.0.0.0');

async function startServer() {
  if (development) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ server: { middlewareMode: true, host: HOST }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    serveFrontend(app, path.resolve(__dirname, 'dist'));
  }
  const server = app.listen(PORT, HOST, () => {
    console.log(`Server: http://${HOST}:${PORT} (Supabase, ${process.env.NODE_ENV})`);
    if (process.env.NODE_ENV === 'production') {
      const stopCleanup = startSessionCleanup();
      server.once('close', stopCleanup);
    }
  });
}
startServer().catch(err => { console.error(err); process.exit(1); });
