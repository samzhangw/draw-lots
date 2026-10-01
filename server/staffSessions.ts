import { runtimeEnv } from './runtime';
import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { createStore } from './store';
import { fingerprint } from './credentials';
import { ApiError } from './errors';

const COOKIE = 'ntcust_staff_session';
const options = () => ({ httpOnly: true, secure: runtimeEnv().NODE_ENV === 'production', sameSite: 'strict' as const, path: '/api' });
function readToken(req: Request) {
  const raw = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return raw && /^[a-f0-9]{64}$/.test(raw) ? raw : null;
}
export async function clearStaffSession(req: Request, res: Response) {
  const token = readToken(req);
  if (token) {
    const { error } = await createStore().client.from('ntcust_staff_sessions').delete().eq('token_hash', fingerprint(token));
    if (error) throw new ApiError(503, '登入服務暫時無法使用。');
  }
  res.clearCookie(COOKIE, options());
}
export async function createStaffSession(req: Request, res: Response, accessToken: string, userId: string, expiresAt: number, remember: boolean) {
  await clearStaffSession(req, res);
  const token = randomBytes(32).toString('hex');
  const { error } = await createStore().client.from('ntcust_staff_sessions').insert({
    token_hash: fingerprint(token), user_id: userId, access_token: accessToken,
    expires_at: new Date(expiresAt * 1000).toISOString(),
  });
  if (error) throw new ApiError(503, '登入服務暫時無法使用。');
  res.cookie(COOKIE, token, { ...options(), ...(remember ? { maxAge: Math.max(0, expiresAt * 1000 - Date.now()) } : {}) });
}
export async function getStaffSession(req: Request, required = true) {
  const token = readToken(req);
  if (!token) {
    if (required) throw new ApiError(401, '請先登入。');
    return null;
  }
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
}
