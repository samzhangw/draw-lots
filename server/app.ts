import express, { type Request, type Response, type NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import { randomUUID, randomBytes } from 'node:crypto';
import { createStore, ApiError, validateProjects, validateDomains, type DatabaseState } from './store';
import { projectDto, stageProjectDto, studentProjectDto, publicStudentProjectDto, prepareProjects, verifyStudentPassword, invalidateSharedPasswordVerification, hashPassword, sharedPasswordHash } from './credentials';
import { createStudentSession, getStudentProject, clearStudentSession } from './studentSessions';
import { createStaffSession, getStaffSession, clearStaffSession } from './staffSessions';
import { loginLimiter, anonymousLimiter, sessionLimiter } from './rateLimit';
import { readSessionToken, sessionScopeForPath, sessionWork } from './sessionSecurity';
import { studentLoginWork, staffLoginWork } from './loginAdmission';
import { ResourceBusyError, timedFetch } from './resourceLimits';
import { runtimeEnv } from './runtime';
import { publicError } from './errors';
import { auditQuery, type AuditActor } from './audit';
import { auditActionLabels, type AuditAction } from '../src/lib/auditTypes';
import { executeAllDomainsIndependentLottery } from '../src/lib/lottery';
import { LotteryAllocationError } from '../src/lib/groupCapacities';
import { resolveLotteryFields } from './lotteryScope';
import { domainDeletionError } from '../src/lib/domainDeletion';
import { testLottery } from '../src/lib/lotteryTest';
import { domainCodeCollisionError, getDrawCodeNamespace, sortDomainConfigs } from '../src/lib/domainCodes';

export const app = express();
const SHARED_PASSWORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
app.disable('x-powered-by');
app.use('/api', (_req, res, next) => {
  res.locals.requestId = randomUUID();
  res.setHeader('X-Request-ID', res.locals.requestId);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});
app.use('/api', (req, res, next) => {
  if (req.method === 'POST') {
    if (!req.is('application/json')) return res.status(400).json({ success: false, error: '請使用有效的 JSON 物件。' });
    const origin = req.get('origin');
    if (req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ success: false, error: '不允許跨站操作。' });
    if (origin) {
      try { if (new URL(origin).host !== req.get('host')) return res.status(403).json({ success: false, error: '不允許跨站操作。' }); }
      catch { return res.status(403).json({ success: false, error: '不允許跨站操作。' }); }
    }
  }
  next();
});
const studentSessionLimit = sessionLimiter('student');
const staffSessionLimit = sessionLimiter('staff');
// Runs before auth/database access, including the pre-body roster authorization.
app.use('/api', (req, res, next) => {
  const path = req.path.toLowerCase().replace(/\/+$/, '');
  const scope = sessionScopeForPath(path);
  if (!scope) return next();
  // Clearing a missing/invalid cookie is safe and needs no database or limiter.
  if (path.endsWith('/logout') && !readSessionToken(req, scope)) return next();
  (scope === 'student' ? studentSessionLimit : staffSessionLimit)(req, res, next);
});
// Authenticate roster writes before accepting their larger body allowance.
app.post('/api/projects', (req, _res, next) => { void authorize(req, true).then(() => next()).catch(next); });
const loginJson = express.json({ limit: '4kb' });
const rosterJson = express.json({ limit: '5mb' });
const smallJson = express.json({ limit: '64kb' });
app.use((req, res, next) => {
  const path = req.path.toLowerCase().replace(/\/+$/, '');
  const parser = ['/api/auth/verify', '/api/student/verify'].includes(path) ? loginJson
    : path === '/api/projects' && req.method === 'POST' ? rosterJson : smallJson;
  parser(req, res, next);
});
app.use('/api', (req, res, next) => {
  if (req.method === 'POST' && (!req.body || Array.isArray(req.body))) {
    res.status(400).json({ success: false, error: '請使用有效的 JSON 物件。' }); return;
  }
  next();
});
// Reject blank login fields before rate-limit buckets, queues or upstream work.
app.use((req, _res, next) => {
  const path = req.path.toLowerCase().replace(/\/+$/, '');
  if (req.method !== 'POST' || !['/api/auth/verify', '/api/student/verify'].includes(path)) return next();
  const staff = path === '/api/auth/verify';
  const account = staff ? req.body?.username : req.body?.leaderId;
  if (typeof account !== 'string' || !account.trim()) {
    return next(new ApiError(400, staff ? '請輸入登入 Email。' : '請輸入組長學號。'));
  }
  if (typeof req.body?.password !== 'string' || !req.body.password.trim()) {
    return next(new ApiError(400, staff ? '請輸入通行密碼。' : '請輸入大會提供的密碼登入。'));
  }
  next();
});
const route = (handler: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { Promise.resolve(handler(req, res)).catch(next); };

const loginRoute = (scope: 'staff' | 'student', handler: (req: Request, res: Response) => Promise<unknown>) =>
  route((req, res) => (scope === 'student' ? studentLoginWork : staffLoginWork).run(() => handler(req, res)));

const staffIdentities = new WeakMap<Request, NonNullable<Awaited<ReturnType<typeof getStaffSession>>>>();
async function staffIdentity(req: Request) {
  const cached = staffIdentities.get(req);
  if (cached) return cached;
  const identity = (await getStaffSession(req))!;
  staffIdentities.set(req, identity);
  return identity;
}
async function auditActor(req: Request): Promise<AuditActor> {
  const identity = await staffIdentity(req);
  return { userId: identity.userId, email: identity.profile.username, role: identity.profile.role };
}
async function stateAudit(req: Request, action: AuditAction, fields: string[], count: number, version: number) {
  return { actor: await auditActor(req), action, details: { fields, project_count: count, version: version + 1, summary: auditActionLabels[action] } };
}
async function authorize(req: Request, adminOnly = false) {
  const role = (await staffIdentity(req)).profile.role;
  if (adminOnly && role !== 'admin') throw new ApiError(403, '此操作僅限管理員。');
  return role;
}
function staffState(state: DatabaseState, role: 'admin' | 'stage') {
  const base = {
    success: true, version: state.version, lastUpdated: state.lastUpdated,
    sharedPasswordEnabled: !!sharedPasswordHash(state.projects),
  };
  if (role === 'stage') return {
    ...base,
    domainConfigs: state.domainConfigs.map(c => ({ id: c.id, field: c.field, groupCount: c.groupCount, ...(c.code ? { code: c.code } : {}), ...(c.groupCapacities ? { groupCapacities: c.groupCapacities } : {}) })),
    projects: state.projects.map(stageProjectDto),
  };
  return {
    ...base, domainConfigs: state.domainConfigs,
    projects: state.projects.map(p => ({ ...projectDto(p), password_set: !!p.password_hash && !p.password })),
  };
}
function checkVersion(req: Request, state: DatabaseState) {
  if (!Number.isInteger(req.body.version)) throw new ApiError(400, '缺少資料版本，請重新整理。');
  if (req.body.version !== state.version) throw new ApiError(409, '資料已由其他人更新，請重新整理後再操作。');
}

app.get('/api/health', anonymousLimiter('health', 120, 3600), route(async (_req, res) => {
  await createStore().health();
  res.json({ status: 'ok' });
}));
app.get('/api/public/results', anonymousLimiter('results', 1200, 12000), route(async (req, res) => {
  const field = req.query.field;
  if (field !== undefined && (typeof field !== 'string' || field.length > 512)) throw new ApiError(400, '請選擇有效的領域。');
  res.json({ success: true, ...await createStore().publicResults(field as string | undefined) });
}));
app.post('/api/auth/verify', loginLimiter('staff'), loginRoute('staff', async (req, res) => {
  const { username, password, targetView } = req.body;
  if (typeof username !== 'string' || username.length > 256 || typeof password !== 'string' || password.length > 128 || !['admin', 'stage'].includes(targetView)) throw new ApiError(400, '請輸入 Email、密碼與有效的登入頁面。');
  // Separate auth client: signing in must never replace the database client's privileged token.
  const url = runtimeEnv().SUPABASE_URL;
  const key = runtimeEnv().SUPABASE_PUBLISHABLE_KEY || runtimeEnv().SUPABASE_ANON_KEY;
  if (!url || !key) throw new ApiError(503, '尚未設定 Supabase Auth 連線資訊。');
  const auth = createClient(url, key, { global: { fetch: timedFetch }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await auth.auth.signInWithPassword({ email: username.trim(), password });
  if (error || !data.session) throw new ApiError(401, 'Email 或密碼不正確。');
  const role = data.user.app_metadata.role;
  if (!['admin', 'stage'].includes(role) || (targetView === 'admin' && role !== 'admin')) throw new ApiError(403, '此帳號尚未獲得操作權限。');
  await createStaffSession(req, res, data.session.access_token, data.user.id, data.session.expires_at!, req.body.remember === true, { userId: data.user.id, email: data.user.email || '', role });
  res.json({ success: true, session: { role, username: data.user.email || '', displayName: role === 'admin' ? '大會系統管理員' : '抽籤展演人員', loginTime: new Date().toISOString(), expiresAt: data.session.expires_at } });
}));
app.get('/api/auth/me', route(async (req, res) => {
  res.json({ success: true, session: (await getStaffSession(req))!.profile });
}));
app.post('/api/auth/logout', route(async (req, res) => {
  let actor: AuditActor | undefined;
  if (readSessionToken(req, 'staff')) {
    try { actor = await auditActor(req); }
    catch (error) { if (!(error instanceof ApiError) || ![401, 403].includes(error.status)) throw error; }
  }
  await clearStaffSession(req, res, actor);
  res.json({ success: true });
}));
app.post('/api/student/verify', loginLimiter('student', 10, 1200), loginRoute('student', async (req, res) => {
  const { leaderId, password } = req.body;
  if (typeof leaderId !== 'string' || leaderId.length > 128 || typeof password !== 'string' || password.length > 128) throw new ApiError(400, '請輸入有效的組長學號與密碼。');
  const store = createStore();
  let project = await store.findProject('leader_key', leaderId.trim().toLowerCase());
  const valid = await verifyStudentPassword(password, project);
  if (!valid || !project) throw new ApiError(401, '學號或密碼不正確，若仍無法登入，請洽大會管理員。');
  // The RPC rechecks credentials and replaces the session atomically.
  project = await createStudentSession(req, res, project);
  res.json({ success: true, sharedPasswordMode: project.shared_password_mode === true, project: project.shared_password_mode ? publicStudentProjectDto(project) : studentProjectDto(project) });
}));
app.get('/api/student/me', route(async (req, res) => {
  const project = await getStudentProject(req);
  res.json({ success: true, sharedPasswordMode: project.shared_password_mode === true, project: project.shared_password_mode ? publicStudentProjectDto(project) : studentProjectDto(project) });
}));
app.post('/api/student/logout', route(async (req, res) => {
  await clearStudentSession(req, res);
  res.json({ success: true });
}));
app.get('/api/staff-audit', route(async (req, res) => {
  await authorize(req, true);
  const filters = auditQuery(req.query);
  let query = createStore().client.from('ntcust_staff_audit')
    .select('id,occurred_at,actor_email,actor_role,action,details')
    .gte('occurred_at', filters.from).lte('occurred_at', filters.to).order('id', { ascending: false }).limit(51);
  if (filters.q) query = query.ilike('search_text', `%${filters.q}%`);
  if (filters.action) query = query.eq('action', filters.action);
  if (filters.role) query = query.eq('actor_role', filters.role);
  if (filters.before) query = query.lt('id', filters.before);
  const { data, error } = await sessionWork.run(async () => await query);
  if (error?.code === 'PGRST205' || error?.code === '42P01') { res.json({ success: true, enabled: false, records: [], nextCursor: null }); return; }
  if (error || !Array.isArray(data)) throw new ApiError(503, '操作紀錄暫時無法讀取，請稍後再試。');
  const records = data.slice(0, 50);
  res.json({ success: true, enabled: true, records, nextCursor: data.length > 50 ? String(records[49].id) : null });
}));
app.get('/api/state', route(async (req, res) => {
  const role = await authorize(req);
  res.json(staffState(await createStore().load(), role));
}));
app.get('/api/projects', route(async (req, res) => {
  await authorize(req, true);
  res.json(staffState(await createStore().load(), 'admin'));
}));
app.get('/api/domain-configs', route(async (req, res) => {
  await authorize(req, true);
  const state = await createStore().load();
  res.json({ success: true, domainConfigs: state.domainConfigs, version: state.version });
}));
app.post('/api/projects', route(async (req, res) => {
  validateProjects(req.body.projects);
  if (runtimeEnv().LOGIN_LIMITER && req.body.projects.filter((p: { password?: string }) => p.password).length > 100) throw new ApiError(400, '單次最多設定 100 組學生密碼，請分批設定；無密碼名冊仍可匯入 2000 筆。');
  const store = createStore();
  const state = await store.load();
  checkVersion(req, state);
  // Validate the complete configuration before preparing passwords or saving
  // anything. Existing empty domains also count towards the setting limit.
  const domainConfigs = [...state.domainConfigs];
  for (const p of req.body.projects) {
    if (!domainConfigs.some(c => c.field === p.field)) domainConfigs.push({ id: `domain-${crypto.randomUUID()}`, field: p.field, groupCount: 2, evaluatorsPerGroup: {} });
  }
  validateDomains(domainConfigs);
  state.projects = await prepareProjects(req.body.projects, state.projects);
  state.domainConfigs = domainConfigs;
  res.json(staffState(await store.save(state, state.version), 'admin'));
}));
app.post('/api/student/shared-password', route(async (req, res) => {
  await authorize(req, true);
  if (req.body.action !== 'generate' && req.body.action !== 'clear') throw new ApiError(400, '共用密碼操作無效。');
  const store = createStore();
  const state = await store.load();
  checkVersion(req, state);
  sharedPasswordHash(state.projects);
  if (!state.projects.length) throw new ApiError(400, '請先匯入學生名冊。');
  if (req.body.action === 'clear') {
    state.projects = state.projects.map(p => ({ ...projectDto(p) }));
    const saved = await store.save(state, state.version, await stateAudit(req, 'shared_password_clear', [], state.projects.length, state.version));
    invalidateSharedPasswordVerification();
    res.json(staffState(saved, 'admin'));
    return;
  }
  const password = Array.from(randomBytes(8), byte => SHARED_PASSWORD_ALPHABET[byte & 31]).join('');
  const password_hash = await hashPassword(password);
  state.projects = state.projects.map(p => ({ ...projectDto(p), password_hash, shared_password_mode: true }));
  const saved = await store.save(state, state.version, await stateAudit(req, 'shared_password_generate', [], state.projects.length, state.version));
  invalidateSharedPasswordVerification();
  res.json({ ...staffState(saved, 'admin'), password });
}));
app.post('/api/domain-configs', route(async (req, res) => {
  await authorize(req, true);
  validateDomains(req.body.domainConfigs);
  const store = createStore();
  const state = await store.load();
  checkVersion(req, state);
  for (const next of req.body.domainConfigs) {
    const previous = state.domainConfigs.find(c => c.id === next.id);
    if (previous && getDrawCodeNamespace(previous.field, state.domainConfigs) !== getDrawCodeNamespace(next.field, req.body.domainConfigs)
      && state.projects.some(p => p.field === previous.field && (p.draw_code || p.draw_order || p.assigned_group || p.draw_time))) {
      throw new ApiError(409, `「${previous.field}」已有抽籤結果，請先重設此領域再修改對應字母。`);
    }
  }
  const renamed = req.body.renamedField;
  if (renamed && (typeof renamed.oldName !== 'string' || typeof renamed.newName !== 'string')) throw new ApiError(400, '領域更名格式不正確。');
  const deletionError = domainDeletionError(state.projects, state.domainConfigs, req.body.domainConfigs);
  if (deletionError) throw new ApiError(409, deletionError);
  if (renamed) state.projects = state.projects.map(p => p.field === renamed.oldName ? { ...p, field: renamed.newName } : p);
  const removedFields = state.domainConfigs.filter(c => !req.body.domainConfigs.some((next: { id: string }) => next.id === c.id)).map(c => c.field);
  state.domainConfigs = sortDomainConfigs(req.body.domainConfigs);
  state.projects = state.projects.map(p => {
    const updated = removedFields.includes(p.field) ? { ...p, field: state.domainConfigs[0]?.field || '未分類領域' } : p;
    const cfg = state.domainConfigs.find(c => c.field === updated.field);
    // Validate the resulting assignment before saving any configuration or project changes.
    if (updated.assigned_group && (!cfg || updated.assigned_group > cfg.groupCount)) {
      throw new ApiError(409, `「${updated.field}」仍有第 ${updated.assigned_group} 組的抽籤結果，無法移除該組；請先重設此領域再修改分組設定。`);
    }
    return updated.assigned_group && cfg ? { ...updated, evaluators: cfg.evaluatorsPerGroup?.[updated.assigned_group] || [] } : updated;
  });
  for (const cfg of state.domainConfigs) {
    const drawn = state.projects.filter(p => p.field === cfg.field && p.assigned_group);
    if (cfg.groupCapacities && drawn.length && Array.from({ length: cfg.groupCount }, (_, i) => i + 1)
      .some(group => drawn.filter(p => p.assigned_group === group).length !== cfg.groupCapacities![group])) {
      throw new ApiError(409, `「${cfg.field}」已有抽籤結果與各組設定件數不符，請先重設此領域再修改每組件數。`);
    }
  }
  const collision = domainCodeCollisionError([...state.domainConfigs.map(c => c.field), ...state.projects.map(p => p.field)], state.domainConfigs);
  if (collision) throw new ApiError(400, collision);
  res.json(staffState(await store.save(state, state.version), 'admin'));
}));
app.post('/api/lottery/test', route(async (req, res) => {
  await authorize(req, true);
  const state = await createStore().load();
  checkVersion(req, state);
  const field = req.body.field ?? 'ALL';
  if (typeof field !== 'string' || !field.trim()) throw new ApiError(400, '請選擇有效的測試領域。');
  if (!state.projects.some(p => field === 'ALL' || p.field === field)) throw new ApiError(400, '目前範圍內沒有專題可測試。');
  res.json(testLottery(state.projects, state.domainConfigs, field, state.version));
}));
app.post('/api/lottery/draw', route(async (req, res) => {
  const role = await authorize(req);
  const store = createStore();
  const state = await store.load();
  checkVersion(req, state);
  const fields = resolveLotteryFields(req.body, [...new Set([...state.domainConfigs.map(c => c.field), ...state.projects.map(p => p.field)])]);
  const pool = state.projects.filter(p => fields.has(p.field));
  if (!pool.length) throw new ApiError(400, '目前範圍內沒有專題。');
  if (pool.some(p => p.draw_order)) throw new ApiError(409, '此範圍已有抽籤結果，請先重設再抽籤。');
  const collision = domainCodeCollisionError([...state.domainConfigs.map(c => c.field), ...state.projects.map(p => p.field)], state.domainConfigs);
  if (collision) throw new ApiError(400, collision);
  try {
    const allocated = executeAllDomainsIndependentLottery(pool, state.domainConfigs).updatedProjects;
    const byId = new Map(allocated.map(p => [p.id, p]));
    state.projects = state.projects.map(p => byId.get(p.id) || p);
    const seenCodes = new Set<string>();
    for (const p of state.projects) {
      if (!p.draw_code) continue;
      if (seenCodes.has(p.draw_code)) throw new LotteryAllocationError(`抽籤編號「${p.draw_code}」重複，結果未儲存。請先檢查領域設定並重設衝突領域的抽籤結果。`);
      seenCodes.add(p.draw_code);
    }
  } catch (error) {
    if (error instanceof LotteryAllocationError) throw new ApiError(400, error.message);
    throw error;
  }
  const saved = await store.save(state, state.version, await stateAudit(req, 'draw', [...fields], pool.length, state.version));
  res.json({ ...staffState(saved, role), summary: `抽籤完成，${pool.length} 件專題結果已儲存。` });
}));
app.post('/api/lottery/reset', route(async (req, res) => {
  const role = await authorize(req);
  const store = createStore();
  const state = await store.load();
  checkVersion(req, state);
  const fields = resolveLotteryFields(req.body, [...new Set([...state.domainConfigs.map(c => c.field), ...state.projects.map(p => p.field)])]);
  state.projects = state.projects.map(p => fields.has(p.field) ? { ...p, assigned_group: null, draw_order: null, draw_code: null, draw_time: null, evaluators: [] } : p);
  res.json(staffState(await store.save(state, state.version, await stateAudit(req, 'reset', [...fields], state.projects.filter(p => fields.has(p.field)).length, state.version)), role));
}));
app.use('/api', (_req, res) => { res.status(404).json({ success: false, error: '找不到此 API。' }); });
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const requestId = res.locals.requestId || randomUUID();
  res.setHeader('X-Request-ID', requestId);
  if (err instanceof ResourceBusyError) res.setHeader('Retry-After', err.retryAfter);
  const { status, body } = publicError(err, requestId);
  if (status >= 500) console.error('API request failed:', {
    requestId, status, type: err instanceof ApiError ? 'ApiError' : 'UnexpectedError',
  });
  res.status(status).json(body);
});
