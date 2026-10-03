import React, { useRef, useState } from 'react';
import { apiRequest } from '../lib/api';
import { AlertCircle, CheckCircle, LoaderCircle } from 'lucide-react';

export function StaffInvitation({ tokenHash }: { tokenHash: string | null }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loginPath, setLoginPath] = useState<string | null>(null);
  const pending = useRef(false);
  const token = useRef(tokenHash);
  const secure = window.location.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending.current || !token.current || !secure) return;
    if (password !== confirmation) { setError('兩次輸入的密碼不一致。'); return; }
    if (password.length < 12 || password.length > 128 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      setError('密碼須為 12 至 128 個字元，並包含英文字母與數字。'); return;
    }
    pending.current = true; setBusy(true); setError(null);
    try {
      const result = await apiRequest<{ loginPath: string }>('/api/auth/invite', { tokenHash: token.current, password });
      token.current = null; setPassword(''); setConfirmation('');
      setLoginPath(result.loginPath === '/stage' ? '/stage' : '/admin');
    } catch (failure) {
      setPassword(''); setConfirmation('');
      setError(failure instanceof Error ? failure.message : '設定失敗，請聯絡大會管理員。');
    } finally { pending.current = false; setBusy(false); }
  };
  return <main className="min-h-[100dvh] flex items-center justify-center bg-slate-50 p-4">
    <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <img src="/android-chrome-512x512.png" alt="專題成果展" className="mx-auto mb-4 h-14 w-14 object-contain" />
      <h1 className="text-center text-2xl font-black text-slate-900">{loginPath ? '帳號設定完成' : '接受工作人員邀請'}</h1>
      {loginPath ? <div className="mt-6 text-center space-y-4"><CheckCircle className="mx-auto h-10 w-10 text-emerald-600" /><p className="text-sm text-slate-600">請使用受邀的 Email 與剛設定的密碼登入。</p><a className="block rounded-xl bg-slate-900 p-3 font-bold text-white" href={loginPath}>前往登入</a></div>
        : !secure || !tokenHash ? <div role="alert" className="mt-6 rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{!secure ? '請從 HTTPS 網址開啟邀請信，避免密碼在傳送途中外洩。' : '邀請連結不完整，或頁面已重新載入。請從最新邀請信重新開啟；若仍無法使用，請聯絡大會管理員。'}</div>
        : <form onSubmit={submit} className="mt-6 space-y-4">
          <p className="text-sm leading-relaxed text-slate-600">設定登入密碼即可完成邀請。操作權限由大會管理員配置。</p>
          <label className="block text-sm font-bold text-slate-700" htmlFor="invite-password">新密碼</label>
          <input id="invite-password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={password} disabled={busy} onChange={e => setPassword(e.target.value)} className="w-full rounded-xl border border-slate-300 p-3" aria-describedby="invite-password-hint" />
          <p id="invite-password-hint" className="text-xs text-slate-500">12 至 128 個字元，包含英文字母與數字。</p>
          <label className="block text-sm font-bold text-slate-700" htmlFor="invite-confirmation">再次輸入密碼</label>
          <input id="invite-confirmation" type="password" autoComplete="new-password" required maxLength={128} value={confirmation} disabled={busy} onChange={e => setConfirmation(e.target.value)} className="w-full rounded-xl border border-slate-300 p-3" />
          {error && <p role="alert" className="flex gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-700"><AlertCircle className="h-5 w-5 shrink-0" />{error}</p>}
          <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 p-3 font-bold text-white disabled:opacity-50">{busy && <LoaderCircle className="h-4 w-4 animate-spin" />}{busy ? '正在驗證與設定…' : '接受邀請並設定密碼'}</button>
        </form>}
    </section>
  </main>;
}
