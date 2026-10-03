import type { SupabaseClient } from '@supabase/supabase-js';
import { createStore } from './store';

export const SESSION_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
export const SESSION_CLEANUP_BATCH_SIZE = 100;
export const SESSION_CLEANUP_MAX_BATCHES = 5;
const TABLES = ['ntcust_student_sessions', 'ntcust_staff_sessions'] as const;

/** Bounded maintenance: only expired rows, never roster data or active sessions. */
export async function cleanupExpiredSessions(client: SupabaseClient = createStore().client, now = Date.now()) {
  const cutoff = new Date(now).toISOString();
  const results = await Promise.allSettled(TABLES.map(async table => {
    let count = 0;
    for (let batch = 0; batch < SESSION_CLEANUP_MAX_BATCHES; batch++) {
      const selected = await client.from(table).select('token_hash').lte('expires_at', cutoff)
        .order('expires_at').order('token_hash').limit(SESSION_CLEANUP_BATCH_SIZE);
      if (selected.error || !Array.isArray(selected.data) || selected.data.length > SESSION_CLEANUP_BATCH_SIZE
        || selected.data.some(row => typeof row.token_hash !== 'string' || !/^[a-f0-9]{64}$/.test(row.token_hash))) {
        throw new Error(`Session cleanup read failed: ${table}`);
      }
      if (!selected.data.length) break;
      // Recheck expiry during DELETE to protect rows changed since the SELECT.
      const deleted = await client.from(table).delete({ count: 'exact' }).lte('expires_at', cutoff)
        .in('token_hash', selected.data.map(row => row.token_hash));
      if (deleted.error) throw new Error(`Session cleanup delete failed: ${table}`);
      count += deleted.count ?? 0;
      if (selected.data.length < SESSION_CLEANUP_BATCH_SIZE) break;
    }
    return count;
  }));
  if (results.some(result => result.status === 'rejected')) throw new Error('過期 Session 清理失敗，將於下一次排程重試。');
  return Object.fromEntries(TABLES.map((table, index) => [table, (results[index] as PromiseFulfilledResult<number>).value]));
}

export async function runSessionCleanup() {
  const counts = await cleanupExpiredSessions();
  console.info('Expired session cleanup completed:', counts);
  return counts;
}

/** Node production: run at startup, then every ten minutes, without overlaps. */
export function startSessionCleanup(run: () => Promise<unknown> = runSessionCleanup, intervalMs = SESSION_CLEANUP_INTERVAL_MS) {
  let running = false;
  let stopped = false;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try { await run(); }
    catch { console.error('Expired session cleanup failed; retrying at the next scheduled interval.'); }
    finally { running = false; }
  };
  const timer = setInterval(() => { void tick(); }, intervalMs);
  timer.unref();
  void tick();
  return () => { stopped = true; clearInterval(timer); };
}
