import { runtimeEnv } from './runtime';
import { ShortCache, timedFetch } from './resourceLimits';
import { createClient } from '@supabase/supabase-js';
import type { DomainConfig, ProjectItem } from '../src/types';
import { removeLegacyCredentials, sharedPasswordHash, type StoredProject } from './credentials';
import { normalizeOriginalCodes } from '../src/lib/originalCodes';
import { domainCodeCollisionError, sortDomainConfigs } from '../src/lib/domainCodes';
import { normalizeProfessorName } from '../src/lib/lottery';
import { LotteryAllocationError, validateGroupCapacities } from '../src/lib/groupCapacities';
import { ApiError } from './errors';
import { auditMigrationPending, type AuditEvent } from './audit';
export { ApiError } from './errors';

export interface PublicResult {
  field: string; original_code: string; assigned_group: number | null;
  draw_order: number; draw_code: string | null;
}
const publicResultsCache = new ShortCache<PublicResult[]>(5000);
const healthCache = new ShortCache<void>(2000);

export interface DatabaseState {
  projects: StoredProject[];
  domainConfigs: DomainConfig[];
  version: number;
  lastUpdated: string;
}

export function createStore() {
  const url = runtimeEnv().SUPABASE_URL;
  const key = runtimeEnv().SUPABASE_SECRET_KEY || runtimeEnv().SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new ApiError(503, '尚未設定 SUPABASE_URL 與 SUPABASE_SECRET_KEY，請參閱 README。');
  const client = createClient(url, key, {
    global: { fetch: timedFetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  // Deploy the API before applying migration 005. Only a missing schema enables
  // this temporary adapter; outages/permission errors must never fall back.
  const load = async (): Promise<DatabaseState> => {
    let result = await client.rpc('ntcust_load_lottery_state');
    if (result.error?.code === 'PGRST202') {
      result = await client.from('ntcust_lottery_state').select('*').eq('id', 1).single();
    }
    const { data, error } = result;
    if (error || !data) throw new ApiError(503, '資料庫暫時無法讀取，請稍後再試。');
    return { projects: normalizeOriginalCodes<StoredProject>(data.projects, data.domain_configs), domainConfigs: sortDomainConfigs(data.domain_configs), version: data.version, lastUpdated: data.updated_at };
  };
  return {
    client,
    load,
    async health(): Promise<void> {
      return healthCache.get(url, async () => {
        const signal = AbortSignal.timeout(5000);
        const results = await Promise.all([
          client.from('ntcust_lottery_state').select('id', { head: true, count: 'exact' }).eq('id', 1).limit(1).abortSignal(signal),
          client.from('ntcust_student_sessions').select('token_hash', { head: true }).limit(1).abortSignal(signal),
          client.from('ntcust_staff_sessions').select('token_hash', { head: true }).limit(1).abortSignal(signal),
        ]);
        if (results.some(result => result.error) || results[0].count !== 1) throw new ApiError(503, '資料庫暫時無法讀取。');
      });
    },
    async publicResults(): Promise<PublicResult[]> {
      return publicResultsCache.get(url, async () => {
        const signal = AbortSignal.timeout(5000);
        // Paginate below PostgREST's usual 1000-row cap. Version checks keep
        // several pages from becoming a mixed snapshot during an import/draw.
        for (let attempt = 0; attempt < 2; attempt++) {
          const metadata = await client.from('ntcust_lottery_state').select('version').eq('id', 1).abortSignal(signal).single();
          if (metadata.error) throw new ApiError(503, '公開結果暫時無法讀取。');
          const results: PublicResult[] = [];
          for (let offset = 0; offset < 2000; offset += 500) {
            const { data, error } = await client.from('ntcust_projects')
              .select('field:document->>field,original_code:document->>original_code,assigned_group:document->assigned_group,draw_order:document->draw_order,draw_code:document->>draw_code')
              .not('document->>draw_order', 'is', null).order('position').range(offset, offset + 499).abortSignal(signal);
            if (error) throw new ApiError(503, '公開結果暫時無法讀取，請確認專題資料列 migration 已套用。');
            results.push(...data.map(p => ({ field: p.field, original_code: p.original_code,
              assigned_group: typeof p.assigned_group === 'number' ? p.assigned_group : null,
              draw_order: Number(p.draw_order), draw_code: p.draw_code ?? null })));
            if (data.length < 500) break;
          }
          const after = await client.from('ntcust_lottery_state').select('version').eq('id', 1).abortSignal(signal).single();
          if (after.error) throw new ApiError(503, '公開結果暫時無法讀取。');
          if (metadata.data.version === after.data.version) return results;
        }
        throw new ApiError(503, '資料正在更新，請稍後再試。');
      });
    },
    async findProject(key: 'id' | 'leader_key', value: string): Promise<StoredProject | undefined> {
      const { data, error } = await client.from('ntcust_projects').select('document').eq(key, value).maybeSingle();
      if (error?.code === 'PGRST205' || error?.code === '42P01') {
        const state = await load();
        sharedPasswordHash(state.projects);
        return state.projects.find(p => key === 'id' ? p.id === value : p.leader_id.trim().toLowerCase() === value);
      }
      if (error) throw new ApiError(503, '資料庫暫時無法讀取，請稍後再試。');
      return data?.document;
    },
    async save(state: DatabaseState, expectedVersion: number, audit?: AuditEvent): Promise<DatabaseState> {
      const domainConfigs = sortDomainConfigs(state.domainConfigs);
      const projects = normalizeOriginalCodes(removeLegacyCredentials(state.projects), state.domainConfigs);
      const params = { p_projects: projects, p_domain_configs: domainConfigs, p_expected_version: expectedVersion };
      let result = audit ? await client.rpc('ntcust_save_lottery_state_audited', {
        ...params, p_actor: audit.actor, p_action: audit.action, p_details: audit.details,
      }) : await client.rpc('ntcust_save_lottery_state', params);
      if (audit && result.error?.code === 'PGRST202') {
        auditMigrationPending();
        result = await client.rpc('ntcust_save_lottery_state', params);
      }
      if (result.error?.code === 'PGRST202') {
        result = await client.from('ntcust_lottery_state').update({
          projects, domain_configs: domainConfigs, version: expectedVersion + 1,
          updated_at: new Date().toISOString(),
        }).eq('id', 1).eq('version', expectedVersion).select('*').maybeSingle();
        if (!result.error && !result.data) throw new ApiError(409, '資料已由其他人更新，請重新整理後再操作。');
      }
      const { data, error } = result;
      if (error?.code === '40001') throw new ApiError(409, '資料已由其他人更新，請重新整理後再操作。');
      if (error || !data) throw new ApiError(503, '資料庫暫時無法儲存，請稍後再試。');
      publicResultsCache.invalidate(url);
      healthCache.invalidate(url);
      return { projects: data.projects, domainConfigs: sortDomainConfigs(data.domain_configs), version: data.version, lastUpdated: data.updated_at };
    },
  };
}

export function validateProjects(value: unknown): asserts value is ProjectItem[] {
  if (!Array.isArray(value)) throw new ApiError(400, '專題名冊必須為陣列。');
  if (value.length > 2000) throw new ApiError(400, '專題名冊最多 2000 筆。');
  const ids = new Set<string>();
  const leaders = new Set<string>();
  const textFields = ['id', 'seq_no', 'education_system', 'department', 'class_name', 'advisor', 'field', 'original_code', 'project_title', 'leader_id'];
  for (const p of value) {
    if (!p || typeof p !== 'object' || 'password_hash' in p || 'shared_password_mode' in p || textFields.some(key => typeof p[key] !== 'string') || !p.id.trim() || !p.project_title.trim() || !p.leader_id.trim() || ids.has(p.id)) {
      throw new ApiError(400, '專題欄位不完整或 ID 重複。');
    }
    if (textFields.some(key => p[key].length > (key === 'project_title' ? 2000 : key === 'leader_id' ? 128 : 512))) throw new ApiError(400, '專題文字欄位過長。');
    for (const key of ['draw_order', 'assigned_group']) {
      if (p[key] != null && (!Number.isInteger(p[key]) || p[key] < 1)) throw new ApiError(400, '抽籤順位與組別必須為正整數。');
    }
    if (p.password != null && typeof p.password !== 'string') throw new ApiError(400, '密碼格式不正確。');
    if (p.draw_time != null && (typeof p.draw_time !== 'string' || Number.isNaN(Date.parse(p.draw_time)))) throw new ApiError(400, '抽籤時間格式不正確。');
    if (p.draw_code != null && (typeof p.draw_code !== 'string' || p.draw_code.length > 512)) throw new ApiError(400, '抽籤編號格式不正確。');
    if (p.evaluators != null && (!Array.isArray(p.evaluators) || p.evaluators.length > 100 || p.evaluators.some((x: unknown) => typeof x !== 'string' || x.length > 128))) throw new ApiError(400, '評審格式不正確。');
    const leader = p.leader_id.trim().toLowerCase();
    if (leaders.has(leader)) throw new ApiError(400, '組長學號不得重複。');
    leaders.add(leader);
    ids.add(p.id);
  }
}

export function validateDomains(value: unknown): asserts value is DomainConfig[] {
  if (!Array.isArray(value)) throw new ApiError(400, '領域設定必須為陣列。');
  if (value.length > 100) throw new ApiError(400, '領域設定最多 100 筆。');
  const ids = new Set<string>();
  const fields = new Set<string>();
  for (const c of value) {
    if (!c || typeof c.id !== 'string' || !c.id.trim() || typeof c.field !== 'string' || !c.field.trim() || c.id.length > 512 || c.field.length > 512 || ids.has(c.id) || fields.has(c.field) || !Number.isInteger(c.groupCount) || c.groupCount < 1 || c.groupCount > 50) throw new ApiError(400, '領域 ID、名稱不得重複，組數須為 1 至 50。');
    if (c.code !== undefined && (typeof c.code !== 'string' || !/^[A-Z]$/.test(c.code))) throw new ApiError(400, '領域對應字母須為 A 至 Z 的單一大寫英文字母。');
    if (c.groupCapacities !== undefined) {
      try { validateGroupCapacities(c.groupCapacities, c.groupCount, c.field); }
      catch (error) {
        if (error instanceof LotteryAllocationError) throw new ApiError(400, error.message);
        throw error;
      }
    }
    if (c.evaluatorsPerGroup != null && (typeof c.evaluatorsPerGroup !== 'object' || Array.isArray(c.evaluatorsPerGroup))) throw new ApiError(400, '評審設定格式不正確。');
    for (const [group, names] of Object.entries(c.evaluatorsPerGroup || {})) {
      if (!/^[1-9]\d*$/.test(group) || Number(group) > c.groupCount) {
        throw new ApiError(400, `「${c.field}」僅設定 ${c.groupCount} 組，評審名單包含無效組別，請重新確認。`);
      }
      if (!Array.isArray(names) || names.length > 100 || names.some(name => typeof name !== 'string' || name.length > 128)) throw new ApiError(400, '評審設定格式不正確。');
      if (Array.isArray(names) && names.some((name: string) => !normalizeProfessorName(name))) {
        throw new ApiError(400, `「${c.field}」第 ${group} 組的評審姓名不可空白或僅有職稱，請填寫完整姓名。`);
      }
    }
    ids.add(c.id); fields.add(c.field);
  }
  const collision = domainCodeCollisionError(fields, value);
  if (collision) throw new ApiError(400, collision);
}
