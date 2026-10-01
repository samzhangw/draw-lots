import React, { useState, useEffect, useRef } from 'react';
import { apiRequest } from '../lib/api';
import { ProjectItem } from '../types';
import {
  UserCheck,
  Clock,
  Award,
  AlertCircle,
  RefreshCw,
  CheckCircle2,
  ChevronRight,
  FileText,
  User,
  Lock,
  Eye,
  EyeOff,
  LogIn,
  Layers,
  Users,
} from 'lucide-react';

export const StudentPortal: React.FC = () => {
  const [studentIdInput, setStudentIdInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [myProject, setMyProject] = useState<ProjectItem | null>(null);
  const [sharedPasswordMode, setSharedPasswordMode] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const requestEpoch = useRef(0);

  const onRefresh = async () => {
    if (isLoading) return;
    requestEpoch.current++;
    setIsLoading(true);
    try {
      const data = await apiRequest<{ project: ProjectItem; sharedPasswordMode: boolean }>('/api/student/me');
      setMyProject(data.project);
      setSharedPasswordMode(data.sharedPasswordMode);
      setErrorMessage('');
    } catch (error) {
      setMyProject(null);
      setSharedPasswordMode(false);
      setErrorMessage(error instanceof Error ? error.message : '查詢失敗');
    } finally { setIsLoading(false); }
  };
  useEffect(() => {
    let cancelled = false;
    const epoch = requestEpoch.current;
    apiRequest<{ project: ProjectItem; sharedPasswordMode: boolean }>('/api/student/me')
      .then(data => { if (!cancelled && requestEpoch.current === epoch) { setMyProject(data.project); setSharedPasswordMode(data.sharedPasswordMode); } })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const handleLogout = async () => {
    if (isLoading) return;
    requestEpoch.current++;
    setIsLoading(true);
    try {
      await apiRequest('/api/student/logout', {});
      setMyProject(null);
      setSharedPasswordMode(false);
      setStudentIdInput('');
      setPasswordInput('');
      setErrorMessage('');
    } catch (error) { setErrorMessage(error instanceof Error ? error.message : '登出失敗'); }
    finally { setIsLoading(false); }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    setErrorMessage('');
    const query = studentIdInput.trim();
    const pwd = passwordInput;

    if (!query) {
      setErrorMessage('請輸入組長學號');
      return;
    }

    if (!pwd) {
      setErrorMessage('請輸入大會提供的組長登入密碼');
      return;
    }

    requestEpoch.current++;
    setIsLoading(true);
    try {
      const data = await apiRequest<{ project: ProjectItem; sharedPasswordMode: boolean }>('/api/student/verify', { leaderId: query, password: pwd });
      setMyProject(data.project);
      setSharedPasswordMode(data.sharedPasswordMode);
      setPasswordInput('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '登入失敗');
    } finally { setIsLoading(false); }
  };

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-6 py-6 sm:py-8 space-y-6 sm:space-y-8">
      {/* Top Banner (Pure Light Academic Style, zero pills) */}
      <div className="rounded-3xl bg-gradient-to-r from-blue-50/90 via-slate-50 to-indigo-50/70 p-6 sm:p-8 md:p-9 text-slate-900 shadow-xs border border-slate-200/90 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
        <div className="max-w-2xl space-y-2">
          <div className="flex items-center gap-2 text-xs sm:text-sm text-blue-700 font-semibold tracking-wide">
            <img
              src="https://cidsexhibition.nutc.edu.tw/images/logo.png"
              alt="國立臺中科技大學 資訊與流通學院"
              className="h-5 sm:h-6 w-auto object-contain"
            />
            <span>國立臺中科技大學</span>
            <span className="text-slate-400" aria-hidden="true">·</span>
            <span>資訊與流通學院專題成果發表會</span>
          </div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black tracking-tight text-slate-900">
            各組報告順序查詢
          </h1>
        </div>
        <div className="hidden sm:flex shrink-0 p-3 bg-white/90 rounded-2xl border border-slate-200/80 shadow-xs">
          <img
            src="https://cidsexhibition.nutc.edu.tw/images/logo.png"
            alt="國立臺中科技大學 資訊與流通學院"
            className="h-12 md:h-14 w-auto object-contain"
          />
        </div>
      </div>

      {!myProject ? (
        /* Focused Clean Login Card */
        <div className="max-w-lg mx-auto">
          <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs">
            <div>
              <div className="flex items-center justify-between pb-4 mb-5 border-b border-slate-100">
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-slate-900">
                    組長帳號驗證
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    請在下方輸入組長學號與密碼
                  </p>
                </div>
                <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 border border-blue-100">
                  <UserCheck className="w-5 h-5" />
                </div>
              </div>

                <form onSubmit={handleLogin} className="space-y-4">
                  {/* Student ID */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      組長學號
                    </label>
                    <div className="relative">
                      <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                        <User className="w-4 h-4" />
                      </div>
                      <input
                        type="text"
                        value={studentIdInput}
                        onChange={(e) => setStudentIdInput(e.target.value)}
                        placeholder="請輸入組長學號，例如 110214101"
                        className="w-full bg-slate-50/80 hover:bg-slate-50 focus:bg-white border border-slate-200 rounded-xl pl-10 pr-4 py-3 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 text-sm sm:text-base font-mono tracking-wide transition-all"
                        autoComplete="username"
                      />
                    </div>
                  </div>

                  {/* Password */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                        <Lock className="w-3.5 h-3.5 text-slate-400" />
                        <span>登入密碼</span>
                      </label>
                    </div>
                    <div className="relative">
                      <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                        <Lock className="w-4 h-4" />
                      </div>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={passwordInput}
                        onChange={(e) => setPasswordInput(e.target.value)}
                        placeholder="請輸入大會提供的密碼"
                        className="w-full bg-slate-50/80 hover:bg-slate-50 focus:bg-white border border-slate-200 rounded-xl pl-10 pr-10 py-3 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 text-sm sm:text-base font-mono tracking-wide transition-all"
                        autoComplete="current-password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 cursor-pointer transition-colors"
                        title={showPassword ? '隱藏密碼' : '顯示密碼'}
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-500 mt-1.5">
                      <span>尚未取得密碼或忘記密碼，請洽大會管理員重新設定。</span>
                    </div>
                  </div>

                  {/* Error Notification */}
                  {errorMessage && (
                    <div className="flex items-start gap-2.5 p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs sm:text-sm animate-in fade-in">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                      <span className="leading-snug">{errorMessage}</span>
                    </div>
                  )}

                  {/* Submit Button */}
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full py-3.5 px-5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm sm:text-base shadow-sm hover:shadow-md transition-all hover:scale-[1.005] active:scale-[0.99] flex items-center justify-center gap-2 cursor-pointer mt-2"
                  >
                    <LogIn className="w-4 h-4" />
                    <span>立即驗證登入並查詢順序</span>
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </button>
                </form>
              </div>


            </div>
          </div>
      ) : (
        /* Logged In View */
        <div className="space-y-5 sm:space-y-6">
          {/* Top Status Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4 bg-white p-3.5 sm:p-5 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center gap-2.5 sm:gap-3">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100 shrink-0">
                <User className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
              <div>
                <div className="text-[11px] sm:text-xs text-slate-500">目前狀態</div>
                <div className="text-sm sm:text-base font-bold text-slate-900 flex items-center gap-1.5">
                  學生查詢已登入
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              <button
                onClick={onRefresh}
                disabled={isLoading}
                className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200/80 text-xs font-medium text-slate-700 border border-slate-200 transition-colors cursor-pointer"
                title="重新整理以同步最新抽籤結果"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-blue-600' : ''}`} />
                <span className="hidden sm:inline">即時重新整理</span>
                <span className="sm:hidden">更新</span>
              </button>
              <button
                onClick={handleLogout}
                disabled={isLoading}
                className="text-xs text-slate-500 hover:text-rose-600 underline underline-offset-4 cursor-pointer"
              >
                登出 / 切換學號
              </button>
            </div>
          </div>

          {/* Main Showcase Card */}
          <div className="rounded-3xl bg-white border border-slate-200 p-5 sm:p-7 md:p-8 shadow-sm space-y-6">
            {myProject.draw_order ? (
              <div className="space-y-6">
                {/* Project Header Info */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-5 border-b border-slate-100">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-md border border-emerald-200 text-xs">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        抽籤完成·順序已確認
                      </span>
                    </div>
                    {!sharedPasswordMode && <>
                    <h2 className="text-xl sm:text-2xl md:text-3xl font-black text-slate-900 leading-tight">
                      {myProject.project_title}
                    </h2>
                    </>}
                  </div>

                  {!sharedPasswordMode &&
                  <div className="text-right sm:text-right shrink-0">
                    <div className="text-[11px] text-slate-400">現場抽籤時間</div>
                    <div className="text-xs font-mono font-medium text-slate-600">
                      {myProject.draw_time
                        ? new Date(myProject.draw_time).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                        : '現場即時同步'}
                    </div>
                  </div>}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4" aria-label="抽籤結果">
                  <section className="rounded-3xl bg-indigo-950 p-6 sm:p-8 text-white shadow-sm min-h-44 flex flex-col justify-between gap-5">
                    <div className="flex items-center gap-2 text-sm font-semibold text-indigo-200">
                      <Users className="w-5 h-5" />
                      分組場次
                    </div>
                    <div className="text-5xl sm:text-6xl font-black tracking-tight">第 {myProject.assigned_group ?? '—'} 組</div>
                  </section>
                  <section className="rounded-3xl border-2 border-rose-200 bg-rose-50 p-6 sm:p-8 text-rose-950 min-h-44 flex flex-col justify-between gap-5">
                    <div className="flex items-center gap-2 text-sm font-semibold text-rose-700">
                      <Award className="w-5 h-5" />
                      上台順序
                    </div>
                    <div className="text-5xl sm:text-6xl font-black tracking-tight text-rose-700">第 {myProject.draw_order} 位</div>
                  </section>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 sm:px-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                      <Layers className="w-4 h-4" />
                      領域名稱
                    </div>
                    <div className="mt-1 text-lg sm:text-xl font-bold text-slate-900 break-words">{myProject.field}</div>
                  </div>
                  {myProject.draw_code && <div className="sm:text-right min-w-0">
                    <div className="text-xs font-semibold text-slate-500">抽籤編號</div>
                    <div className="mt-1 text-sm sm:text-base font-bold text-slate-800 break-all">{myProject.draw_code}</div>
                  </div>}
                </div>
                {!sharedPasswordMode && !!myProject.evaluators?.length && <p className="text-xs text-slate-600 px-1">
                  評審委員：{myProject.evaluators.join('、')}
                </p>}
              </div>
            ) : (
              /* Undrawn Waiting State */
              <div className="space-y-6">
                <div className="text-center py-6 sm:py-8 px-4">
                  <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-3 border border-amber-200">
                    <Clock className="w-6 h-6 sm:w-7 sm:h-7" />
                  </div>
                  <h3 className="text-base sm:text-xl font-bold text-slate-900 mb-1.5">
                    目前尚未抽籤或抽籤進行中
                  </h3>
                  <p className="text-slate-600 text-xs sm:text-sm max-w-md mx-auto mb-4 leading-relaxed">
                    {sharedPasswordMode ? '抽籤完成後即可在此查驗公開的分組場次與出場順序。' : <>貴組專題「<span className="text-slate-900 font-semibold">{myProject.project_title}</span>」已登記在名冊中，抽籤完成後即可在此即時查驗分組場次與出場順序。</>}
                  </p>
                  <button
                    onClick={onRefresh}
                    className="px-4 sm:px-5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold inline-flex items-center gap-2 border border-slate-200 transition-colors cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-amber-600" />
                    <span>重新整理抓取最新狀態</span>
                  </button>
                </div>

                {/* 3大關鍵報告卡片 (待抽籤預覽) */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-slate-100">
                  {!sharedPasswordMode && <div className="rounded-2xl p-4 sm:p-5 bg-slate-50 border border-slate-200 space-y-1.5">
                    <div className="text-xs font-bold text-slate-500 flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-blue-600" />
                      領域名稱 (已登記)
                    </div>
                    <div className="text-lg sm:text-xl font-bold text-slate-900">
                      {myProject.field}
                    </div>
                  </div>}

                  <div className="rounded-2xl p-4 sm:p-5 bg-slate-50 border border-slate-200 space-y-1.5">
                    <div className="text-xs font-bold text-slate-500 flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-indigo-600" />
                      分組場次
                    </div>
                    <div className="text-lg sm:text-xl font-bold text-amber-600 flex items-center gap-1.5">
                      <Clock className="w-4 h-4 animate-spin text-amber-500" />
                      待現場抽籤分組
                    </div>
                    <div className="text-[11px] text-slate-400">現場抽出後即刻更新</div>
                  </div>

                  <div className="rounded-2xl p-4 sm:p-5 bg-slate-50 border border-slate-200 space-y-1.5">
                    <div className="text-xs font-bold text-slate-500 flex items-center gap-1.5">
                      <Award className="w-3.5 h-3.5 text-rose-600" />
                      報告出場順序
                    </div>
                    <div className="text-lg sm:text-xl font-bold text-amber-600 flex items-center gap-1.5">
                      <Clock className="w-4 h-4 animate-spin text-amber-500" />
                      待現場抽籤決定
                    </div>
                    <div className="text-[11px] text-slate-400">抽籤後顯示順序編號</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Presentation Notes */}
          <div className="bg-slate-50 rounded-2xl border border-slate-200 p-4 sm:p-5 text-xs text-slate-600 space-y-1.5">
            <h4 className="font-bold text-slate-800 flex items-center gap-1.5">
              <FileText className="w-4 h-4 text-amber-600" />
              專題展報告注意事項提醒
            </h4>
            <ul className="list-disc list-inside space-y-1 text-slate-600">
              <li>報告時間：每組發表 7 分鐘，評審委員提問答詢 3 分鐘，共計 10 分鐘（按鈴提醒）。</li>
              <li>請於發表前 2 組至指定分組場次候席區就座，並攜帶備份簡報隨身碟。</li>
              <li>發表順序以本系統現場抽出之分組與順位為準。</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};
