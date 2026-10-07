import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PublicResultsCache } from '../server/publicResultsCache';

const domains = [{ id: 'a', field: '智慧', groupCount: 1 }];
const row = { draw_code: 'A01', assigned_group: 1, project_title: '專題', leader_name: '林同學' };

test('concurrent public reads share one result fetch and expire after the TTL', async () => {
  const cache = new PublicResultsCache(10);
  let reads = 0;
  const metadata = async () => ({ version: 1, domain_configs: domains });
  const results = async () => { reads++; return [row]; };
  const requests = await Promise.all(Array.from({ length: 20 }, () => cache.get('db', '智慧', metadata, results)));
  assert.equal(reads, 1);
  assert.ok(requests.every(result => result.results[0].draw_code === 'A01'));
  await new Promise(resolve => setTimeout(resolve, 20));
  await cache.get('db', '智慧', metadata, results);
  assert.equal(reads, 2);
});

test('version changes from another server, local invalidation and outages never retain stale results', async () => {
  const cache = new PublicResultsCache();
  let version = 1;
  let rows = [row];
  const metadata = async () => ({ version, domain_configs: domains });
  assert.equal((await cache.get('db', '智慧', metadata, async () => rows)).results.length, 1);
  version++; rows = [];
  assert.deepEqual((await cache.get('db', '智慧', metadata, async () => rows)).results, []);
  cache.invalidate('db');
  rows = [row];
  assert.equal((await cache.get('db', '智慧', metadata, async () => rows)).results.length, 1);
  await assert.rejects(cache.get('db', '智慧', async () => { throw new Error('offline'); }, async () => []), /offline/);
  assert.deepEqual((await cache.get('another-db', '智慧', metadata, async () => [])).results, []);
});

test('a write during result loading retries against the new version without caching a mixed snapshot', async () => {
  const cache = new PublicResultsCache();
  let version = 1;
  let reads = 0;
  const response = await cache.get('db', '智慧', async () => ({ version, domain_configs: domains }), async () => {
    reads++;
    if (reads === 1) { version++; return [row]; }
    return [];
  });
  assert.equal(reads, 2);
  assert.equal(response.version, 2);
  assert.deepEqual(response.results, []);
});

test('invalidating an in-flight request cannot restore its older cache entry', async () => {
  const cache = new PublicResultsCache();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const metadata = async () => ({ version: 1, domain_configs: domains });
  const old = cache.get('db', '智慧', metadata, async () => { started(); await gate; return [row]; });
  await ready;
  cache.invalidate('db');
  assert.deepEqual((await cache.get('db', '智慧', metadata, async () => [])).results, []);
  release(); await old;
  assert.deepEqual((await cache.get('db', '智慧', metadata, async () => [row])).results, []);
});
