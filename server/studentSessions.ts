import { runtimeEnv } from './runtime';
import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { createStore } from './store';
import { fingerprint, type StoredProject } from './credentials';
import { ApiError } from './errors';

const COOKIE = 'ntcust_student_session';
const MAX_AGE = 60 * 60 * 1000;
const options = () => ({ httpOnly: true, secure: runtimeEnv().NODE_ENV === 'production', sameSite: 'strict' as const, path: '/api/student' });
function readToken(req: Request): string | null {
  const raw = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return raw && /^[a-f0-9]{64}$/.test(raw) ? raw : null;
}
export async function clearStudentSession(req: Request, res: Response): Promise<void> {
  res.clearCookie(COOKIE, options());
  const token = readToken(req);
  if (!token) return;
  const { error } = await createStore().client.from('ntcust_student_sessions').delete().eq('token_hash', fingerprint(token));
  if (error) throw new ApiError(503, '登入服務暫時無法使用。');
}
export async function createStudentSession(req: Request, res: Response, project: StoredProject): Promise<void> {
  await clearStudentSession(req, res);
  const token = randomBytes(32).toString('hex');
  const { error } = await createStore().client.from('ntcust_student_sessions').insert({
    token_hash: fingerprint(token), project_id: project.id,
    credential_version: fingerprint(project.password_hash!),
    expires_at: new Date(Date.now() + MAX_AGE).toISOString(),
  });
  if (error) throw new ApiError(503, '登入服務暫時無法使用。');
  res.cookie(COOKIE, token, { ...options(), maxAge: MAX_AGE });
}
export async function getStudentProject(req: Request): Promise<StoredProject> {
  const token = readToken(req);
  if (!token) throw new ApiError(401, '請先登入學生查詢。');
  const store = createStore();
  const { data, error } = await store.client.from('ntcust_student_sessions').select('project_id, credential_version, expires_at').eq('token_hash', fingerprint(token)).maybeSingle();
  if (error) throw new ApiError(503, '登入服務暫時無法使用。');
  if (!data || Date.parse(data.expires_at) <= Date.now()) throw new ApiError(401, '學生登入已過期，請重新登入。');
  const p = await store.findProject('id', data.project_id);
  if (!p?.password_hash || p.password || fingerprint(p.password_hash) !== data.credential_version) throw new ApiError(401, '學生登入已失效，請重新登入。');
  return p;
}
