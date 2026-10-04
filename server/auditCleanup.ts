import type { SupabaseClient } from '@supabase/supabase-js';
import { createStore } from './store';

export const AUDIT_CLEANUP_BATCH_SIZE = 500;
export const AUDIT_CLEANUP_MAX_BATCHES = 5;
let warned = false;

export async function cleanupExpiredAudit(client: SupabaseClient = createStore().client) {
  let deleted = 0;
  for (let batch = 0; batch < AUDIT_CLEANUP_MAX_BATCHES; batch++) {
    // The database decides the cutoff; clients cannot request deletion of recent logs.
    const result = await client.rpc('ntcust_cleanup_staff_audit');
    if (result.error?.code === 'PGRST202') {
      if (!warned) {
        console.warn('Staff audit retention migration is not installed; audit cleanup is not active.');
        warned = true;
      }
      return { enabled: false, deleted };
    }
    if (result.error || !Number.isInteger(result.data) || result.data < 0 || result.data > AUDIT_CLEANUP_BATCH_SIZE) {
      throw new Error('操作紀錄清理失敗，將於下一次排程重試。');
    }
    deleted += result.data;
    if (result.data < AUDIT_CLEANUP_BATCH_SIZE) break;
  }
  return { enabled: true, deleted };
}
