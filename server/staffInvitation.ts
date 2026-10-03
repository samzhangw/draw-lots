import { createClient } from '@supabase/supabase-js';
import { runtimeEnv } from './runtime';
import { timedFetch } from './resourceLimits';
import { ApiError } from './errors';

export function validateInvitationInput(body: Record<string, unknown>) {
  if (Object.keys(body).some(key => !['tokenHash', 'password'].includes(key)) ||
      typeof body.tokenHash !== 'string' || !/^[a-f0-9]{40,128}$/i.test(body.tokenHash)) {
    throw new ApiError(400, '邀請連結格式不正確，請從最新邀請信重新開啟。');
  }
  if (typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 128 ||
      !/[A-Za-z]/.test(body.password) || !/[0-9]/.test(body.password)) {
    throw new ApiError(400, '密碼須為 12 至 128 個字元，並包含英文字母與數字。');
  }
  return { tokenHash: body.tokenHash, password: body.password };
}

export async function acceptStaffInvitation(body: Record<string, unknown>) {
  const { tokenHash, password } = validateInvitationInput(body);
  const env = runtimeEnv();
  const key = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY;
  if (!env.SUPABASE_URL || !key) throw new ApiError(503, '登入服務暫時無法使用。');
  // Isolated public-key client; never mutate the privileged database client.
  const client = createClient(env.SUPABASE_URL, key, {
    global: { fetch: timedFetch }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.auth.verifyOtp({ token_hash: tokenHash, type: 'invite' });
  if (error || !data.session || !data.user) throw new ApiError(400, '邀請已失效或已使用，請聯絡大會管理員重新寄送。');
  try {
    // Authoritative role check: user_metadata and submitted role/user ID are never trusted.
    const { data: identity, error: identityError } = await client.auth.getUser(data.session.access_token);
    if (identityError || !identity.user || identity.user.id !== data.user.id) throw new ApiError(400, '邀請驗證失敗，請聯絡大會管理員重新寄送。');
    const role = identity.user.app_metadata.role;
    if (role !== 'admin' && role !== 'stage') throw new ApiError(403, '此帳號尚未獲得操作權限，請聯絡大會管理員設定角色並重新寄送邀請。');
    const { error: updateError } = await client.auth.updateUser({ password });
    if (updateError) throw new ApiError(400, '密碼設定未完成；請先嘗試以新密碼登入，若無法登入，請聯絡大會管理員重新寄送邀請。');
    // No app session is created and no Supabase token leaves the server.
    return { success: true, loginPath: role === 'admin' ? '/admin' : '/stage' };
  } finally {
    // Revoke the temporary refresh token without signing out other devices.
    await client.auth.signOut({ scope: 'local' }).catch(() => {});
  }
}
