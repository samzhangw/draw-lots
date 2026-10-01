import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiRequest } from '../src/lib/api';

test('a newer read cannot replace the version attached to an older roster snapshot', async () => {
  const originalFetch = globalThis.fetch;
  const sent: unknown[] = [];
  globalThis.fetch = (async (_url: RequestInfo | URL, options?: RequestInit) => {
    if (options?.body) {
      sent.push(JSON.parse(String(options.body)));
      return new Response(JSON.stringify({ success: true, version: 2 }), { status: 200 });
    }
    return new Response(JSON.stringify({ success: true, projects: [], domainConfigs: [], version: 2 }), { status: 200 });
  }) as typeof fetch;
  try {
    await apiRequest('/api/state');
    await apiRequest('/api/projects', { projects: [], version: 1 });
    assert.deepEqual(sent, [{ projects: [], version: 1 }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
