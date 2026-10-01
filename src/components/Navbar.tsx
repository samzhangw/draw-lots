import React, { useState } from 'react';
import { AuthSession } from '../lib/auth';
import { Dices, ShieldCheck, LogOut, LoaderCircle, ChevronDown } from 'lucide-react';

interface NavbarProps {
  authSession?: AuthSession | null;
  onLogout?: () => Promise<void>;
}

export const Navbar: React.FC<NavbarProps> = ({ authSession, onLogout }) => {
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const handleLogout = async () => {
    if (!onLogout || isLoggingOut) return;
    setIsLoggingOut(true);
    try { await onLogout(); }
    finally { setIsLoggingOut(false); }
  };

  const isAdmin = authSession?.role === 'admin';
  const roleLabel = isAdmin ? '大會系統管理員' : '台上抽籤人員';

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/90 bg-white/95 shadow-[0_1px_2px_rgba(15,23,42,0.04)] backdrop-blur-md">
      <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-3 px-3 sm:min-h-20 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-2.5 sm:gap-3" aria-label="國立臺中科技大學資訊與流通學院專題成果展">
          <img
            src="https://cidsexhibition.nutc.edu.tw/images/logo.png"
            alt="國立臺中科技大學 資訊與流通學院"
            className="h-8 w-auto shrink-0 object-contain sm:h-11"
            loading="eager"
          />
          <div className="min-w-0">
            <p className="truncate text-[10px] font-semibold text-slate-500 sm:text-sm">國立臺中科技大學 · 資訊與流通學院</p>
            <p className="truncate text-xs font-black text-slate-900 sm:text-lg">專題成果展 <span className="font-semibold text-rose-700">報告抽籤系統</span></p>
          </div>
        </div>

        {authSession && onLogout && (
          <details className="group relative shrink-0">
            <summary
              aria-label={`目前登入：${roleLabel}，開啟帳號選單`}
              className="flex min-h-10 list-none items-center gap-2 rounded-xl border border-slate-200 bg-white p-1 pr-2 text-slate-800 shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 cursor-pointer [&::-webkit-details-marker]:hidden"
            >
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${isAdmin ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                {isAdmin ? <ShieldCheck className="h-4 w-4" /> : <Dices className="h-4 w-4" />}
              </span>
              <span className="hidden text-xs font-bold whitespace-nowrap xl:block">{roleLabel}</span>
              <ChevronDown className="h-3.5 w-3.5 text-slate-500 transition-transform group-open:rotate-180" />
            </summary>
            <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl shadow-slate-900/10">
              <div className="border-b border-slate-100 px-3 py-2.5">
                <p className="text-sm font-bold text-slate-900">{roleLabel}</p>
                <p className="mt-1 break-all text-xs text-slate-500">{authSession.username}</p>
              </div>
              <button
                onClick={() => void handleLogout()}
                disabled={isLoggingOut}
                type="button"
                className="mt-1 flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-bold text-rose-700 transition-colors hover:bg-rose-50 disabled:cursor-wait disabled:opacity-50 cursor-pointer"
              >
                {isLoggingOut ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <LogOut className="h-4 w-4" />}
                {isLoggingOut ? '登出中…' : isAdmin ? '登出後台' : '登出'}
              </button>
            </div>
          </details>
        )}
      </div>
    </header>
  );
};
