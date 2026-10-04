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
  const token = readSessionToken(req, 'student');
  if (token) {
    const { error } = await sessionWork.run(async () => await createStore().client.from('ntcust_student_sessions').delete().eq('token_hash', fingerprint(token)));
    if (error) throw new ApiError(503, '登入服務暫時無法使用。');
  }
  // Preserve the cookie on failure so the same session can be revoked on retry.
  res.clearCookie(COOKIE, options());
}
export async function createStudentSession(req: Request, res: Response, project: StoredProject): Promise<StoredProject> {
  const token = randomBytes(32).toString('hex');
  const oldToken = readSessionToken(req, 'student');
  const current = await sessionWork.run(async () => {
    const store = createStore();
    const result = await store.client.rpc('ntcust_student_login_finalize', {
      p_project_id: project.id, p_leader_key: project.leader_id.trim().toLowerCase(),
      p_password_hash: project.password_hash!, p_shared_password_mode: project.shared_password_mode === true,
      p_token_hash: fingerprint(token), p_credential_version: fingerprint(project.password_hash!),
      p_old_token_hash: oldToken ? fingerprint(oldToken) : null,
    });
    if (result.error?.code === 'PT401') throw new ApiError(401, '學生資料或密碼已更新或停用，請重新登入。');
    if (result.error?.code !== 'PGRST202') {
      if (result.error) throw new ApiError(503, '登入服務暫時無法使用。');
      return result.data as StoredProject;
    }
    // Rolling deployment only: missing RPC retains the existing indexed path.
    // Never fall back on database outages, permission errors or stale credentials.
    const fresh = await store.findProject('id', project.id);
    if (!fresh || fresh.password || fresh.password_hash !== project.password_hash ||
      (fresh.shared_password_mode === true) !== (project.shared_password_mode === true) ||
      fresh.leader_id.trim().toLowerCase() !== project.leader_id.trim().toLowerCase()) {
      throw new ApiError(401, '學生資料或密碼已更新或停用，請重新登入。');
    }
    const inserted = await store.client.from('ntcust_student_sessions').insert({
      token_hash: fingerprint(token), project_id: fresh.id,
      credential_version: fingerprint(fresh.password_hash!),
      expires_at: new Date(Date.now() + MAX_AGE).toISOString(),
    });
    if (inserted.error) throw new ApiError(503, '登入服務暫時無法使用。');
    if (oldToken) {
      const deleted = await store.client.from('ntcust_student_sessions').delete().eq('token_hash', fingerprint(oldToken));
      if (deleted.error) throw new ApiError(503, '登入服務暫時無法使用。');
    }
    return fresh;
  });
  // Defend against malformed responses; never issue a cookie on RPC failure.
  if (!current || current.id !== project.id || current.password || current.password_hash !== project.password_hash ||
    (current.shared_password_mode === true) !== (project.shared_password_mode === true) ||
    current.leader_id?.trim().toLowerCase() !== project.leader_id.trim().toLowerCase()) {
    throw new ApiError(503, '登入服務暫時無法使用。');
  }
  res.cookie(COOKIE, signSessionToken(token, 'student'), { ...options(), maxAge: MAX_AGE });
  return current;
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
