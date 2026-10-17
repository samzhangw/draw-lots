import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';

const root = new URL('../', import.meta.url);

async function runningServer(args: string[], nodeEnv: string, development: boolean) {
  const reservation = net.createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = (reservation.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  const env = {
    ...process.env, NODE_ENV: nodeEnv, PORT: String(port), HOST: '',
    SUPABASE_URL: '', SUPABASE_SECRET_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '',
    SUPABASE_PUBLISHABLE_KEY: '', SUPABASE_ANON_KEY: '',
  };
  const child = spawn(process.execPath, args, { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  try {
    const deadline = Date.now() + 30000;
    while (!output.includes('Server: http://')) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error(`Startup failed: ${output}`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(output.includes(development ? 'http://127.0.0.1:' : 'http://0.0.0.0:'));
    assert.ok(output.includes(development ? '(Supabase, development)' : '(Supabase, production)'));
    for (const path of ['/server/app.ts', '/server/credentials.ts', '/package.json', '/@vite/client']) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(10000) });
      const body = await response.text();
      if (development) {
        assert.equal(response.status, 200, path);
        assert.doesNotMatch(body, /<!doctype html>/i, path);
      } else {
        // A fresh checkout without dist may return 404; it must never serve source.
        assert.ok(response.status === 404 || (response.status === 200 && /<!doctype html>/i.test(body)), path);
        assert.doesNotMatch(body, /passwordHashLimits|export const app|"dependencies"|function injectQuery/, path);
      }
    }
  } finally {
    if (child.exitCode === null) {
      if (process.platform === 'win32') {
        // The launcher owns a child server; stop this test's entire process tree.
        spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      } else child.kill('SIGTERM');
      if (child.exitCode === null) await once(child, 'exit');
    }
  }
}

test('start serves production assets despite an inherited development setting', { timeout: 45000 }, async () => {
  await runningServer(['scripts/start-server.mjs'], 'development', false);
});

test('direct server startup defaults to production when NODE_ENV is empty', { timeout: 45000 }, async () => {
  await runningServer(['--import', 'tsx', 'server.ts'], '', false);
});

test('explicit development startup opts into Vite and binds only to loopback by default', { timeout: 45000 }, async () => {
  await runningServer(['scripts/start-server.mjs', '--dev'], 'production', true);
});
