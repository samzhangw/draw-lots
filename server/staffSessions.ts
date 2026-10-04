import { runtimeEnv } from './runtime';
import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { createStore } from './store';
import { fingerprint } from './credentials';
import { ApiError } from './errors';
import { auditMigrationPending, type AuditActor } from './audit';
import { readSessionToken, signSessionToken, sessionWork } from './sessionSecurity';

const COOKIE = 'ntcust_staff_session';
const options = () => ({ httpOnly: true, secure: runtimeEnv().NODE_ENV === 'production', sameSite: 'strict' as const, path: '/api' });
export async function clearStaffSession(req: Request, res: Response, actor?: AuditActor) {
  const token = readSessionToken(req, 'staff');
  if (token) {
    const { error } = await sessionWork.run(async () => {
      const client = createStore().client;
      if (actor) {
        const result = await client.rpc('ntcust_end_staff_session', { p_token_hash: fingerprint(token), p_actor: actor });
        if (result.error?.code !== 'PGRST202') return result;
        auditMigrationPending();
      }
      return await client.from('ntcust_staff_sessions').delete().eq('token_hash', fingerprint(token));
    });
    if (error) throw new ApiError(503, '登入服務暫時無法使用。');
  }
  res.clearCookie(COOKIE, options());
}
export async function createStaffSession(req: Request, res: Response, accessToken: string, userId: string, expiresAt: number, remember: boolean, actor: AuditActor) {
  const token = randomBytes(32).toString('hex');
  const oldToken = readSessionToken(req, 'staff');
  const { error } = await sessionWork.run(async () => {
    const client = createStore().client;
    const session = { token_hash: fingerprint(token), user_id: userId, access_token: accessToken, expires_at: new Date(expiresAt * 1000).toISOString() };
    const result = await client.rpc('ntcust_start_staff_session', { p_session: session, p_actor: actor, p_old_token_hash: oldToken ? fingerprint(oldToken) : null });
    if (result.error?.code !== 'PGRST202') return result;
    auditMigrationPending();
    const inserted = await client.from('ntcust_staff_sessions').insert(session);
    if (inserted.error || !oldToken) return inserted;
    return await client.from('ntcust_staff_sessions').delete().eq('token_hash', fingerprint(oldToken));
  });
  if (error) throw new ApiError(503, '登入服務暫時無法使用。');
  res.cookie(COOKIE, signSessionToken(token, 'staff'), { ...options(), ...(remember ? { maxAge: Math.max(0, expiresAt * 1000 - Date.now()) } : {}) });
}
export async function getStaffSession(req: Request, required = true) {
  const token = readSessionToken(req, 'staff');
  if (!token) {
    if (required) throw new ApiError(401, '請先登入。');
    return null;
  }
  return sessionWork.run(async () => {
    const client = createStore().client;
    const { data: session, error } = await client.from('ntcust_staff_sessions').select('*').eq('token_hash', fingerprint(token)).maybeSingle();
    if (error) throw new ApiError(503, '登入服務暫時無法使用。');
    if (!session || Date.parse(session.expires_at) <= Date.now()) throw new ApiError(401, '登入已過期，請重新登入。');
    const { data, error: authError } = await client.auth.getUser(session.access_token);
    if (authError || !data.user || data.user.id !== session.user_id) throw new ApiError(401, '登入已過期，請重新登入。');
    const role = data.user.app_metadata.role;
    if (role !== 'admin' && role !== 'stage') throw new ApiError(403, '此帳號尚未獲得操作權限。');
    return {
      userId: data.user.id,
      profile: { role: role as 'admin' | 'stage', username: data.user.email || '', displayName: role === 'admin' ? '大會系統管理員' : '抽籤展演人員', loginTime: session.created_at, expiresAt: Math.floor(Date.parse(session.expires_at) / 1000) },
    };
  });
}
