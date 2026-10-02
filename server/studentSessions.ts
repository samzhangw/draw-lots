import { runtimeEnv } from './runtime';
import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { createStore } from './store';
import { fingerprint, type StoredProject } from './credentials';
import { ApiError } from './errors';
import { readSessionToken, signSessionToken, sessionWork } from './sessionSecurity';

const COOKIE = 'ntcust_student_session';
const MAX_AGE = 60 * 60 * 1000;
const options = () => ({ httpOnly: true, secure: runtimeEnv().NODE_ENV === 'production', sameSite: 'strict' as const, path: '/api/student' });
export async function clearStudentSession(req: Request, res: Response): Promise<void> {
  res.clearCookie(COOKIE, options());
  const token = readSessionToken(req, 'student');
  if (!token) return;
  const { error } = await sessionWork.run(async () => await createStore().client.from('ntcust_student_sessions').delete().eq('token_hash', fingerprint(token)));
  if (error) throw new ApiError(503, '登入服務暫時無法使用。');
}
export async function createStudentSession(req: Request, res: Response, project: StoredProject): Promise<void> {
  await clearStudentSession(req, res);
  const token = randomBytes(32).toString('hex');
  const { error } = await sessionWork.run(async () => createStore().client.from('ntcust_student_sessions').insert({
    token_hash: fingerprint(token), project_id: project.id,
    credential_version: fingerprint(project.password_hash!),
    expires_at: new Date(Date.now() + MAX_AGE).toISOString(),
  }));
  if (error) throw new ApiError(503, '登入服務暫時無法使用。');
  res.cookie(COOKIE, signSessionToken(token, 'student'), { ...options(), maxAge: MAX_AGE });
}
export async function getStudentProject(req: Request): Promise<StoredProject> {
  const token = readSessionToken(req, 'student');
  if (!token) throw new ApiError(401, '請先登入學生查詢。');
  return sessionWork.run(async () => {
    const store = createStore();
    const lookup = await store.client.rpc('ntcust_student_lookup', { p_token_hash: fingerprint(token) });
    if (lookup.error?.code !== 'PGRST202') {
      if (lookup.error) throw new ApiError(503, '登入服務暫時無法使用。');
      const p = lookup.data?.project as StoredProject | undefined;
      if (!p?.password_hash || p.password || fingerprint(p.password_hash) !== lookup.data.credential_version) {
        throw new ApiError(401, '學生登入已失效，請重新登入。');
      }
      return p;
    }
    // Rolling deployment: retain the indexed two-read path until migration 006.
    const { data, error } = await store.client.from('ntcust_student_sessions').select('project_id, credential_version, expires_at').eq('token_hash', fingerprint(token)).maybeSingle();
    if (error) throw new ApiError(503, '登入服務暫時無法使用。');
    if (!data || Date.parse(data.expires_at) <= Date.now()) throw new ApiError(401, '學生登入已過期，請重新登入。');
    const p = await store.findProject('id', data.project_id);
    if (!p?.password_hash || p.password || fingerprint(p.password_hash) !== data.credential_version) throw new ApiError(401, '學生登入已失效，請重新登入。');
    return p;
  });
}
