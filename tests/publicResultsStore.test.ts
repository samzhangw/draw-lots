import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createStore } from '../server/store';
import { withRuntime } from '../server/runtime';

test('public queries project only requested fields, paginate beyond 1000 rows and detect external resets', async () => {
  let version = 1;
  let reads = 0;
  let rows = Array.from({ length: 1201 }, (_, index) => ({
    draw_code: `A${index + 1}`, assigned_group: 1, project_title: `專題${index + 1}`, leader_name: '林同學',
  }));
  const mock = http.createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/rest/v1/ntcust_lottery_state') {
      assert.equal(url.searchParams.get('select'), 'version,domain_configs');
      res.end(JSON.stringify({ version, domain_configs: [{ id: 'a', field: '智慧', groupCount: 1 }] })); return;
    }
    assert.equal(url.pathname, '/rest/v1/ntcust_projects');
    assert.equal(url.searchParams.get('document->>field'), 'eq.智慧');
    assert.equal(url.searchParams.get('document->draw_order'), 'gt.0');
    assert.equal(url.searchParams.get('select'), 'draw_code:document->>draw_code,assigned_group:document->assigned_group,project_title:document->>project_title,leader_name:document->>leader_name');
    reads++;
    const offset = Number(url.searchParams.get('offset') || 0);
    assert.equal(Number(url.searchParams.get('limit')), 500);
    res.end(JSON.stringify(rows.slice(offset, offset + 500)));
  });
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
  const address = mock.address() as { port: number };
  try {
    await withRuntime({ SUPABASE_URL: `http://127.0.0.1:${address.port}`, SUPABASE_SECRET_KEY: 'test-secret' }, async () => {
      const first = await createStore().publicResults('智慧');
      assert.equal(first.results.length, 1201);
      assert.equal(reads, 3);
      assert.equal((await createStore().publicResults('智慧')).results.length, 1201);
      assert.equal(reads, 3, 'new store instances share cached results');
      version++; rows = [];
      assert.deepEqual((await createStore().publicResults('智慧')).results, []);
      assert.equal(reads, 4, 'external version change bypasses the old cache immediately');
    });
  } finally { await new Promise<void>(resolve => mock.close(() => resolve())); }
});
