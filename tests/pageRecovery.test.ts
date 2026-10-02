import test from 'node:test';
import assert from 'node:assert/strict';
import { isPageAssetError, pageFailureMessage } from '../src/lib/pageRecovery';
import { frontendCacheControl, serveFrontend } from '../server/frontendAssets';
import express from 'express';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

test('page failure shows Chinese offline, updated-module and rendering messages without exception details', () => {
  for (const message of ['Failed to fetch dynamically imported module: /assets/old.js', 'Importing a module script failed.', 'Unable to preload CSS for /assets/old.css', 'ChunkLoadError: Loading chunk 2 failed']) {
    assert.equal(isPageAssetError(new Error(message)), true);
    assert.equal(pageFailureMessage(new Error(message), true).title, '頁面檔案載入失敗');
  }
  assert.equal(pageFailureMessage(new Error('secret-data'), false).title, '目前沒有網路連線');
  const unknown = pageFailureMessage(new Error('secret-data'), true);
  assert.equal(unknown.title, '頁面暫時無法顯示');
  assert.ok(!JSON.stringify(unknown).includes('secret-data'));
  assert.equal(isPageAssetError(new Error('incorrect password')), false);
});

test('frontend cache policy revalidates HTML and only caches versioned asset paths', () => {
  assert.equal(frontendCacheControl('/admin', 'text/html; charset=utf-8'), 'no-cache');
  assert.equal(frontendCacheControl('/assets/old.js', 'text/html'), 'no-cache');
  assert.match(frontendCacheControl('/assets/app-hash.js', 'text/javascript')!, /immutable/);
  assert.equal(frontendCacheControl('/api/state', 'application/json'), null);
});

test('production routes never replace missing modules with HTML and refresh deep-link HTML', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lottery-assets-'));
  await mkdir(join(directory, 'assets'));
  await writeFile(join(directory, 'index.html'), '<html>current-version</html>');
  await writeFile(join(directory, 'assets', 'app-hash.js'), 'export const version=1;');
  const app = express(); serveFrontend(app, directory);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    for (const pathname of ['/', '/admin', '/stage', '/index.html']) {
      const response = await fetch(base + pathname);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-cache');
      assert.match(await response.text(), /current-version/);
    }
    const asset = await fetch(base + '/assets/app-hash.js');
    assert.equal(asset.status, 200); assert.match(asset.headers.get('cache-control')!, /immutable/);
    const missing = await fetch(base + '/assets/old-version.js');
    assert.equal(missing.status, 404); assert.equal(missing.headers.get('cache-control'), 'no-store');
    assert.ok(!/html/.test(missing.headers.get('content-type')!));
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true });
  }
});
