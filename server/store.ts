import { runtimeEnv } from './runtime';
import { createClient } from '@supabase/supabase-js';
import type { DomainConfig, ProjectItem } from '../src/types';
import { removeLegacyCredentials, type StoredProject } from './credentials';
import { normalizeOriginalCodes } from '../src/lib/originalCodes';
import { normalizeProfessorName } from '../src/lib/lottery';
import { ApiError } from './errors';
export { ApiError } from './errors';

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
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return {
    client,
    async load(): Promise<DatabaseState> {
      const { data, error } = await client.from('ntcust_lottery_state').select('*').eq('id', 1).single();
      if (error) throw new ApiError(503, '資料庫暫時無法讀取，請稍後再試。');
      return { projects: normalizeOriginalCodes<StoredProject>(data.projects), domainConfigs: data.domain_configs, version: data.version, lastUpdated: data.updated_at };
    },
    async save(state: DatabaseState, expectedVersion: number): Promise<DatabaseState> {
      const { data, error } = await client.from('ntcust_lottery_state').update({
        projects: normalizeOriginalCodes(removeLegacyCredentials(state.projects)),
        domain_configs: state.domainConfigs,
        version: expectedVersion + 1,
        updated_at: new Date().toISOString(),
      }).eq('id', 1).eq('version', expectedVersion).select('*').maybeSingle();
      if (error) throw new ApiError(503, '資料庫暫時無法儲存，請稍後再試。');
      if (!data) throw new ApiError(409, '資料已由其他人更新，請重新整理後再操作。');
      return { projects: data.projects, domainConfigs: data.domain_configs, version: data.version, lastUpdated: data.updated_at };
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
    for (const key of ['draw_order', 'assigned_group']) {
      if (p[key] != null && (!Number.isInteger(p[key]) || p[key] < 1)) throw new ApiError(400, '抽籤順位與組別必須為正整數。');
    }
    if (p.password != null && typeof p.password !== 'string') throw new ApiError(400, '密碼格式不正確。');
    if (p.draw_time != null && (typeof p.draw_time !== 'string' || Number.isNaN(Date.parse(p.draw_time)))) throw new ApiError(400, '抽籤時間格式不正確。');
    if (p.draw_code != null && typeof p.draw_code !== 'string') throw new ApiError(400, '抽籤編號格式不正確。');
    if (p.evaluators != null && (!Array.isArray(p.evaluators) || p.evaluators.some((x: unknown) => typeof x !== 'string'))) throw new ApiError(400, '評審格式不正確。');
    const leader = p.leader_id.trim().toLowerCase();
    if (leaders.has(leader)) throw new ApiError(400, '組長學號不得重複。');
    leaders.add(leader);
    ids.add(p.id);
  }
}

export function validateDomains(value: unknown): asserts value is DomainConfig[] {
  if (!Array.isArray(value)) throw new ApiError(400, '領域設定必須為陣列。');
  const ids = new Set<string>();
  const fields = new Set<string>();
  for (const c of value) {
    if (!c || typeof c.id !== 'string' || !c.id.trim() || typeof c.field !== 'string' || !c.field.trim() || ids.has(c.id) || fields.has(c.field) || !Number.isInteger(c.groupCount) || c.groupCount < 1 || c.groupCount > 50) throw new ApiError(400, '領域 ID、名稱不得重複，組數須為 1 至 50。');
    if (c.evaluatorsPerGroup != null && (typeof c.evaluatorsPerGroup !== 'object' || Array.isArray(c.evaluatorsPerGroup) || Object.entries(c.evaluatorsPerGroup).some(([g, names]) => !/^\d+$/.test(g) || Number(g) < 1 || !Array.isArray(names) || names.some(x => typeof x !== 'string')))) throw new ApiError(400, '評審設定格式不正確。');
    for (const [group, names] of Object.entries(c.evaluatorsPerGroup || {})) {
      if (Array.isArray(names) && names.some((name: string) => !normalizeProfessorName(name))) {
        throw new ApiError(400, `「${c.field}」第 ${group} 組的評審姓名不可空白或僅有職稱，請填寫完整姓名。`);
      }
    }
    ids.add(c.id); fields.add(c.field);
  }
}
