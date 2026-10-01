import express, { type Request, type Response, type NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import { randomUUID, randomBytes } from 'node:crypto';
import { createStore, ApiError, validateProjects, validateDomains, type DatabaseState } from './store';
import { projectDto, stageProjectDto, studentProjectDto, publicStudentProjectDto, prepareProjects, verifyPassword, hashPassword, sharedPasswordHash } from './credentials';
import { createStudentSession, getStudentProject, clearStudentSession } from './studentSessions';
import { createStaffSession, getStaffSession, clearStaffSession } from './staffSessions';
import { loginLimiter } from './rateLimit';
import { runtimeEnv } from './runtime';
import { publicError } from './errors';
import { executeAllDomainsIndependentLottery, allocateDomainSubgroups } from '../src/lib/lottery';

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
app.use(express.json({ limit: '5mb' }));
app.use('/api', (req, res, next) => {
  if (req.method === 'POST') {
    if (!req.is('application/json') || !req.body || Array.isArray(req.body)) return res.status(400).json({ success: false, error: '請使用有效的 JSON 物件。' });
    const origin = req.get('origin');
    if (req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ success: false, error: '不允許跨站操作。' });
    if (origin) {
      try { if (new URL(origin).host !== req.get('host')) return res.status(403).json({ success: false, error: '不允許跨站操作。' }); }
      catch { return res.status(403).json({ success: false, error: '不允許跨站操作。' }); }
    }
  }
  next();
});
const route = (handler: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { Promise.resolve(handler(req, res)).catch(next); };

async function authorize(req: Request, adminOnly = false) {
  const role = (await getStaffSession(req))!.profile.role;
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
    domainConfigs: state.domainConfigs.map(c => ({ id: c.id, field: c.field, groupCount: c.groupCount })),
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

app.get('/api/health', route(async (_req, res) => {
  const store = createStore();
  const [state, studentSessions, staffSessions] = await Promise.all([
    store.load(),
    store.client.from('ntcust_student_sessions').select('token_hash', { head: true }).limit(1),
    store.client.from('ntcust_staff_sessions').select('token_hash', { head: true }).limit(1),
  ]);
  if (studentSessions.error || staffSessions.error) throw new ApiError(503, '登入資料表尚未就緒。');
  res.json({ status: 'ok', engine: 'supabase', projectCount: state.projects.length, lastUpdated: state.lastUpdated });
}));
app.post('/api/auth/verify', loginLimiter('staff'), route(async (req, res) => {
  const { username, password, targetView } = req.body;
  if (typeof username !== 'string' || username.length > 256 || typeof password !== 'string' || password.length > 128 || !['admin', 'stage'].includes(targetView)) throw new ApiError(400, '請輸入 Email、密碼與有效的登入頁面。');
  // Separate auth client: signing in must never replace the database client's privileged token.
  const url = runtimeEnv().SUPABASE_URL;
  const key = runtimeEnv().SUPABASE_PUBLISHABLE_KEY || runtimeEnv().SUPABASE_ANON_KEY;
  if (!url || !key) throw new ApiError(503, '尚未設定 Supabase Auth 連線資訊。');
  const auth = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await auth.auth.signInWithPassword({ email: username.trim(), password });
  if (error || !data.session) throw new ApiError(401, 'Email 或密碼不正確。');
  const role = data.user.app_metadata.role;
  if (!['admin', 'stage'].includes(role) || (targetView === 'admin' && role !== 'admin')) throw new ApiError(403, '此帳號尚未獲得操作權限。');
  await createStaffSession(req, res, data.session.access_token, data.user.id, data.session.expires_at!, req.body.remember === true);
  res.json({ success: true, session: { role, username: data.user.email || '', displayName: role === 'admin' ? '大會系統管理員' : '抽籤展演人員', loginTime: new Date().toISOString(), expiresAt: data.session.expires_at } });
}));
app.get('/api/auth/me', route(async (req, res) => {
  res.json({ success: true, session: (await getStaffSession(req))!.profile });
}));
app.post('/api/auth/logout', route(async (req, res) => {
  await clearStaffSession(req, res);
  res.json({ success: true });
}));
app.post('/api/student/verify', loginLimiter('student', 10, 600), route(async (req, res) => {
  const { leaderId, password } = req.body;
  if (typeof leaderId !== 'string' || leaderId.length > 128 || typeof password !== 'string' || password.length > 128) throw new ApiError(400, '請輸入有效的組長學號與密碼。');
  const state = await createStore().load();
  sharedPasswordHash(state.projects);
  const project = state.projects.find(p => p.leader_id.trim().toLowerCase() === leaderId.trim().toLowerCase());
  const valid = await verifyPassword(password, project?.password ? undefined : project?.password_hash);
  if (!valid || !project) throw new ApiError(401, '學號或密碼不正確，尚未設定密碼者請洽大會管理員。');
  await createStudentSession(req, res, project);
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
app.get('/api/public-results', route(async (_req, res) => {
  const state = await createStore().load();
  // Public presentation codes only; no student identity, titles, roster or reviewer names.
  res.json({ success: true, results: state.projects.filter(p => p.draw_order).map(p => ({
    field: p.field, original_code: p.original_code, assigned_group: p.assigned_group ?? null,
    draw_order: p.draw_order, draw_code: p.draw_code ?? null,
  })) });
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
  await authorize(req, true);
  validateProjects(req.body.projects);
  if (runtimeEnv().LOGIN_LIMITER && req.body.projects.filter((p: { password?: string }) => p.password).length > 100) throw new ApiError(400, '單次最多設定 100 組學生密碼，請分批設定；無密碼名冊仍可匯入 2000 筆。');
  const store = createStore();
  const state = await store.load();
  checkVersion(req, state);
  state.projects = await prepareProjects(req.body.projects, state.projects);
  // Imported fields become available on the stage immediately.
  for (const p of state.projects) {
    if (!state.domainConfigs.some(c => c.field === p.field)) state.domainConfigs.push({ id: `domain-${crypto.randomUUID()}`, field: p.field, groupCount: 2, evaluatorsPerGroup: {} });
  }
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
    res.json(staffState(await store.save(state, state.version), 'admin'));
    return;
  }
  const password = Array.from(randomBytes(8), byte => SHARED_PASSWORD_ALPHABET[byte & 31]).join('');
  const password_hash = await hashPassword(password);
  state.projects = state.projects.map(p => ({ ...projectDto(p), password_hash, shared_password_mode: true }));
  res.json({ ...staffState(await store.save(state, state.version), 'admin'), password });
}));
app.post('/api/domain-configs', route(async (req, res) => {
  await authorize(req, true);
  validateDomains(req.body.domainConfigs);
  const store = createStore();
  const state = await store.load();
  checkVersion(req, state);
  const renamed = req.body.renamedField;
  if (renamed && (typeof renamed.oldName !== 'string' || typeof renamed.newName !== 'string')) throw new ApiError(400, '領域更名格式不正確。');
  if (renamed) state.projects = state.projects.map(p => p.field === renamed.oldName ? { ...p, field: renamed.newName } : p);
  const removedFields = state.domainConfigs.filter(c => !req.body.domainConfigs.some((next: { id: string }) => next.id === c.id)).map(c => c.field);
  state.domainConfigs = req.body.domainConfigs;
  state.projects = state.projects.map(p => {
    const updated = removedFields.includes(p.field) ? { ...p, field: state.domainConfigs[0]?.field || '未分類領域' } : p;
    const cfg = state.domainConfigs.find(c => c.field === updated.field);
    return updated.assigned_group && cfg ? { ...updated, evaluators: cfg.evaluatorsPerGroup?.[updated.assigned_group] || [] } : updated;
  });
  res.json(staffState(await store.save(state, state.version), 'admin'));
}));
app.post('/api/lottery/draw', route(async (req, res) => {
  const role = await authorize(req);
  const store = createStore();
  const state = await store.load();
  checkVersion(req, state);
  const field = req.body.field || 'ALL';
  const pool = state.projects.filter(p => field === 'ALL' || p.field === field);
  if (!pool.length) throw new ApiError(400, '目前範圍內沒有專題。');
  if (pool.some(p => p.draw_order)) throw new ApiError(409, '此範圍已有抽籤結果，請先重設再抽籤。');
  if (field === 'ALL') state.projects = executeAllDomainsIndependentLottery(state.projects, state.domainConfigs).updatedProjects;
  else {
    const cfg = state.domainConfigs.find(c => c.field === field);
    const allocated = allocateDomainSubgroups(pool, cfg?.groupCount || 2, field, cfg?.evaluatorsPerGroup || {});
    const byId = new Map(allocated.map(p => [p.id, p]));
    state.projects = state.projects.map(p => byId.get(p.id) || p);
  }
  const saved = await store.save(state, state.version);
  res.json({ ...staffState(saved, role), summary: `抽籤完成，${pool.length} 件專題結果已儲存至 Supabase。` });
}));
app.post('/api/lottery/reset', route(async (req, res) => {
  const role = await authorize(req);
  const store = createStore();
  const state = await store.load();
  checkVersion(req, state);
  const field = req.body.field || 'ALL';
  state.projects = state.projects.map(p => field === 'ALL' || p.field === field ? { ...p, assigned_group: null, draw_order: null, draw_code: null, draw_time: null, evaluators: [] } : p);
  res.json(staffState(await store.save(state, state.version), role));
}));
app.use('/api', (_req, res) => { res.status(404).json({ success: false, error: '找不到此 API。' }); });
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const requestId = res.locals.requestId || randomUUID();
  res.setHeader('X-Request-ID', requestId);
  const { status, body } = publicError(err, requestId);
  if (status >= 500) console.error('API request failed:', {
    requestId, status, type: err instanceof ApiError ? 'ApiError' : 'UnexpectedError',
  });
  res.status(status).json(body);
});
