import React, { useState, useEffect, useRef } from 'react';
import { ProjectItem, DomainConfig } from '../types';
import { apiRequest, StoreState } from '../lib/api';
import confetti from 'canvas-confetti';
import {
  Dices,
  Sparkles,
  RotateCcw,
  Maximize2,
  Minimize2,
  Zap,
  CheckCircle2,
  Filter,
  AlertTriangle,
  X,
  Users,
  ShieldCheck,
  Layers,
  ArrowRight,
  Search,
  Table,
  LayoutGrid
} from 'lucide-react';

interface StageLotteryProps {
  projects: ProjectItem[];
  dataVersion: number | null;
  onApplyState: (state: StoreState) => void;
  domainList: string[];
  domainConfigs: DomainConfig[];
}

export const StageLottery: React.FC<StageLotteryProps> = ({
  projects,
  dataVersion,
  onApplyState,
  domainList,
  domainConfigs,
}) => {
  const [selectedField, setSelectedField] = useState<string>('ALL');
  const [isAnimating, setIsAnimating] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  const [batchDrawSummary, setBatchDrawSummary] = useState<string | null>(null);

  // Redesigned board states
  const [boardSearchQuery, setBoardSearchQuery] = useState<string>('');
  const [boardDisplayMode, setBoardDisplayMode] = useState<'lanes' | 'table'>('lanes');
  const [boardDomainFilter, setBoardDomainFilter] = useState<string>('ALL');

  // In-app modal states
  const [isBatchModalOpen, setIsBatchModalOpen] = useState<boolean>(false);
  const [isResetModalOpen, setIsResetModalOpen] = useState<boolean>(false);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);

  const stageContainerRef = useRef<HTMLDivElement>(null);

  // Get current active domain config
  const currentDomainConfig = domainConfigs.find((c) => c.field === selectedField);

  // Filter projects based on selected field
  const currentPool = selectedField === 'ALL'
    ? projects
    : projects.filter((p) => p.field === selectedField);

  const undrawnPool = currentPool.filter((p) => !p.draw_order);
  const drawnPool = currentPool
    .filter((p) => !!p.draw_order)
    .sort((a, b) => {
      // Sort by assigned_group then draw_order
      if (a.assigned_group && b.assigned_group && a.assigned_group !== b.assigned_group) {
        return a.assigned_group - b.assigned_group;
      }
      return (a.draw_order || 0) - (b.draw_order || 0);
    });

  // Toggle fullscreen
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      stageContainerRef.current?.requestFullscreen?.().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.().catch(() => {});
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  // Multi-cannon celebratory confetti
  const triggerCelebration = () => {
    try {
      // Left cannon
      confetti({
        particleCount: 80,
        angle: 60,
        spread: 70,
        origin: { x: 0.1, y: 0.65 },
        colors: ['#e11d48', '#2563eb', '#f59e0b', '#10b981', '#8b5cf6'],
      });
      // Right cannon
      confetti({
        particleCount: 80,
        angle: 120,
        spread: 70,
        origin: { x: 0.9, y: 0.65 },
        colors: ['#e11d48', '#2563eb', '#f59e0b', '#10b981', '#8b5cf6'],
      });
      // Center burst
      setTimeout(() => {
        confetti({
          particleCount: 140,
          spread: 110,
          origin: { x: 0.5, y: 0.5 },
          colors: ['#e11d48', '#2563eb', '#f59e0b', '#10b981', '#8b5cf6', '#06b6d4'],
        });
      }, 250);
    } catch {
      // Fallback
    }
  };

  /**
   * Open Batch Confirmation Modal
   */
  const handleOpenBatchModal = () => {
    if (undrawnPool.length === 0) {
      setNoticeMessage('目前範圍內無尚未抽籤的組別！如需重新抽籤請先點擊重設。');
      return;
    }
    setIsBatchModalOpen(true);
  };

  /**
   * Redesigned One-Click School-Wide Automatic Lottery Animation & Execution
   */
  const handleConfirmBatchDraw = async () => {
    setIsBatchModalOpen(false);
    if (undrawnPool.length === 0 || isAnimating) return;
    if (dataVersion === null) { setNoticeMessage('資料尚未載入，請重新整理後再試。'); return; }

    setIsAnimating(true);
    setBatchDrawSummary(null);
    try {
      // Keep the presentation visible briefly, but only show results returned by the backend.
      const [backendResult] = await Promise.all([
        apiRequest<StoreState & { summary: string }>('/api/lottery/draw', {
          field: selectedField,
          version: dataVersion,
        }),
        new Promise<void>((resolve) => setTimeout(resolve, 2600)),
      ]);
      if (!Array.isArray(backendResult.projects)) throw new Error('抽籤回應格式不正確。');
      setBatchDrawSummary(
        backendResult.summary ||
          (selectedField === 'ALL'
            ? `全校共 ${domainConfigs.length} 個領域已完成獨立分組抽籤。`
            : `「${selectedField}」領域已完成獨立分組抽籤。`)
      );
      onApplyState(backendResult);
      triggerCelebration();
    } catch (apiErr) {
      setNoticeMessage(apiErr instanceof Error ? apiErr.message : '抽籤失敗，請重新整理後再試。');
    } finally {
      setIsAnimating(false);
    }
  };

  /**
   * Reset draw
   */
  const handleOpenResetModal = () => {
    if (drawnPool.length === 0) {
      setNoticeMessage('目前此範圍內尚無任何已抽籤的組別。');
      return;
    }
    setIsResetModalOpen(true);
  };

  const handleConfirmReset = async () => {
    setIsResetModalOpen(false);
    if (dataVersion === null) { setNoticeMessage('資料尚未載入，請重新整理後再試。'); return; }
    try {
      const data = await apiRequest('/api/lottery/reset', { field: selectedField, version: dataVersion });
      onApplyState(data);
      setBatchDrawSummary(null);
    } catch (error) {
      setNoticeMessage(error instanceof Error ? error.message : '重設失敗，請稍後再試。');
    }
  };

  return (
    <div
      ref={stageContainerRef}
      className={`min-h-[calc(100vh-4rem)] bg-gradient-to-b from-blue-50/70 via-white to-slate-50 text-slate-800 transition-all ${
        isFullscreen
          ? 'p-3 sm:p-6 fixed inset-0 z-50 overflow-y-auto bg-white'
          : 'py-4 sm:py-7 px-3 sm:px-6 max-w-[1600px] mx-auto space-y-5 sm:space-y-7'
      }`}
    >
      {/* Presentation control header */}
      <section className="relative overflow-hidden rounded-[1.75rem] border border-blue-100 bg-white text-slate-900 shadow-sm">
        <div className="absolute -right-20 -top-28 h-72 w-72 rounded-full bg-blue-100/80 blur-3xl pointer-events-none" />
        <div className="absolute -left-20 bottom-0 h-52 w-52 rounded-full bg-amber-100/70 blur-3xl pointer-events-none" />
        <div className="relative p-5 sm:p-7 lg:p-9 space-y-6">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5">
            <div className="flex items-center gap-4 min-w-0">
              <div className="h-14 w-14 sm:h-16 sm:w-16 rounded-2xl border border-slate-100 bg-white flex items-center justify-center shrink-0 p-2 shadow-sm">
                <img src="https://cidsexhibition.nutc.edu.tw/images/logo.png" alt="國立臺中科技大學 資訊與流通學院" className="max-h-full max-w-full object-contain" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] sm:text-xs font-semibold tracking-wide text-blue-700">國立臺中科技大學 · 資訊與流通學院</p>
                <h1 className="mt-1 text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight">專題報告抽籤展演</h1>
                <p className="mt-1 text-xs sm:text-sm text-slate-600">各領域獨立分組，現場同步公布發表順位</p>
              </div>
            </div>
            <span className={`self-start inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-xs sm:text-sm font-bold border ${isAnimating ? 'bg-amber-50 border-amber-200 text-amber-800' : currentPool.length === 0 ? 'bg-slate-50 border-slate-200 text-slate-600' : undrawnPool.length ? 'bg-blue-50 border-blue-200 text-blue-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`} aria-live="polite">
              <span className={`h-2 w-2 rounded-full ${isAnimating ? 'bg-amber-500 animate-pulse' : currentPool.length === 0 ? 'bg-slate-400' : undrawnPool.length ? 'bg-blue-500' : 'bg-emerald-500'}`} />
              {isAnimating ? '抽籤進行中' : currentPool.length === 0 ? '尚無專題' : undrawnPool.length ? '等待抽籤' : '抽籤已完成'}
            </span>
          </div>

          <div className="flex flex-col gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:items-end sm:justify-between">
            <label className="block min-w-0">
              <span className="block text-[11px] font-semibold text-slate-600 mb-2">抽籤範圍</span>
              <span className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3.5 py-3 focus-within:ring-2 focus-within:ring-blue-200">
                <Filter className="w-4 h-4 text-blue-700 shrink-0" />
                <select
                  value={selectedField}
                  onChange={(e) => { setSelectedField(e.target.value); setBatchDrawSummary(null); }}
                  disabled={isAnimating}
                  className="w-full min-w-0 bg-transparent text-slate-900 font-semibold text-sm outline-none cursor-pointer disabled:cursor-not-allowed"
                >
                  <option value="ALL">全校所有領域（{projects.length} 件）</option>
                  {domainConfigs.map((cfg) => <option key={cfg.id} value={cfg.field}>{cfg.field}（{projects.filter(p => p.field === cfg.field).length} 件）</option>)}
                </select>
              </span>
            </label>
            <div className="flex items-center gap-2">
              <button onClick={toggleFullscreen} type="button" className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 hover:bg-blue-100 px-4 py-3 text-sm font-bold text-blue-800 transition-colors cursor-pointer" title={isFullscreen ? '退出全螢幕' : '全螢幕大螢幕投影'}>
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                {isFullscreen ? '退出全螢幕' : '全螢幕展示'}
              </button>
              <button onClick={handleOpenResetModal} disabled={isAnimating || drawnPool.length === 0} type="button" className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white hover:bg-rose-50 px-4 py-3 text-sm font-bold text-slate-700 hover:text-rose-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer" title="重設此範圍抽籤結果">
                <RotateCcw className="w-4 h-4" />
                <span className="hidden sm:inline">重設結果</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-3 gap-2 sm:gap-4" aria-label="抽籤數量統計">
        <div className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-5 shadow-sm"><div className="text-[11px] sm:text-sm font-semibold text-slate-500">專題總數</div><div className="mt-1 text-2xl sm:text-4xl font-black text-slate-900 tabular-nums">{currentPool.length}<span className="ml-1 text-xs sm:text-base font-semibold text-slate-500">件</span></div></div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 sm:p-5 shadow-sm"><div className="text-[11px] sm:text-sm font-semibold text-emerald-700">已完成</div><div className="mt-1 text-2xl sm:text-4xl font-black text-emerald-800 tabular-nums">{drawnPool.length}<span className="ml-1 text-xs sm:text-base font-semibold text-emerald-700">件</span></div></div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 sm:p-5 shadow-sm"><div className="text-[11px] sm:text-sm font-semibold text-amber-700">尚待抽籤</div><div className="mt-1 text-2xl sm:text-4xl font-black text-amber-900 tabular-nums">{undrawnPool.length}<span className="ml-1 text-xs sm:text-base font-semibold text-amber-700">件</span></div></div>
      </div>

      {/* Main Big Stage Presentation Card */}
      <section className="relative overflow-hidden rounded-[1.75rem] bg-white border border-blue-100 border-t-4 border-t-blue-500 shadow-lg shadow-blue-100/70 p-5 sm:p-8 lg:p-10 text-center" aria-label="抽籤主舞台">
        {/* Dynamic Glow effects during animation */}
        {isAnimating && (
          <div className="absolute inset-0 bg-gradient-to-r from-blue-500/5 via-rose-500/10 to-amber-500/5 animate-pulse pointer-events-none" />
        )}

        <div className="relative z-10 max-w-5xl mx-auto min-h-[300px] sm:min-h-[350px] flex flex-col items-center justify-center" aria-live="polite">
          {isAnimating ? (
            <div className="w-full space-y-5 py-3 sm:py-5">
              <p className="text-sm font-bold tracking-wide text-blue-700">{selectedField === 'ALL' ? '全校各領域' : selectedField} · 現場抽籤中</p>
              <div className="relative mx-auto flex h-36 w-36 items-center justify-center sm:h-44 sm:w-44" aria-hidden="true">
                <div className="absolute inset-0 rounded-full border-[10px] border-blue-100" />
                <div className="absolute inset-0 rounded-full border-[10px] border-transparent border-t-blue-600 border-r-amber-400 motion-safe:animate-spin" />
                <div className="flex h-24 w-24 items-center justify-center rounded-3xl border border-blue-100 bg-blue-50 text-blue-700 shadow-sm sm:h-28 sm:w-28"><Dices className="h-12 w-12 sm:h-14 sm:w-14 motion-safe:animate-pulse" /></div>
              </div>
              <div>
                <h2 className="text-2xl font-black text-slate-900 sm:text-4xl">正在產生抽籤結果</h2>
                <p className="mt-2 text-sm text-slate-600 sm:text-base">請稍候，正式場次與報告順位將在完成後公布。</p>
              </div>
              <div className="mx-auto grid max-w-2xl grid-cols-3 gap-2 sm:gap-4" aria-hidden="true">
                <div className="rounded-xl border border-blue-100 bg-blue-50 px-2 py-3 text-xs font-bold text-blue-800 sm:text-sm"><Layers className="mx-auto mb-1.5 h-5 w-5" />獨立分組</div>
                <div className="rounded-xl border border-amber-100 bg-amber-50 px-2 py-3 text-xs font-bold text-amber-800 sm:text-sm"><Dices className="mx-auto mb-1.5 h-5 w-5" />隨機抽選</div>
                <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-2 py-3 text-xs font-bold text-emerald-800 sm:text-sm"><CheckCircle2 className="mx-auto mb-1.5 h-5 w-5" />公布順位</div>
              </div>
              <p className="text-xs text-slate-500">此為展示動畫；抽籤結果由後端產生並儲存。</p>
            </div>
          ) : batchDrawSummary ? (
            /* ========================================================
             * Completed Screen
             * ======================================================== */
            <div className="space-y-4 sm:space-y-5 animate-in fade-in zoom-in duration-300 w-full">
              <div className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-emerald-50 text-emerald-700 text-xs font-bold border border-emerald-200 shadow-sm">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{selectedField === 'ALL' ? '全校各領域抽籤完成' : `「${selectedField}」領域抽籤完成`}</span>
              </div>

              <div className="text-2xl sm:text-4xl md:text-5xl font-black text-slate-900 tracking-tight">
                報告場次與順位已排定
              </div>

              <p className="text-xs sm:text-sm text-slate-600 max-w-2xl mx-auto leading-relaxed">
                {batchDrawSummary}
              </p>

              {/* Completed Domain Summary Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 max-w-3xl mx-auto w-full pt-2">
                {(selectedField === 'ALL' ? domainConfigs : domainConfigs.filter((cfg) => cfg.field === selectedField)).map((cfg) => {
                  const teams = projects.filter((p) => p.field === cfg.field);
                  return (
                    <div
                      key={cfg.id}
                      className="p-3 rounded-2xl bg-slate-50 border border-slate-200 text-left hover:border-slate-300 transition-colors"
                    >
                      <div className="flex items-center justify-between text-xs font-bold text-slate-800 truncate">
                        <span className="truncate">{cfg.field}</span>
                        <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.2 rounded font-mono">
                          {cfg.groupCount} 組
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-1 font-mono">
                        共 {teams.length} 件專題
                      </div>
                      <div className="text-[10px] text-emerald-600 font-semibold mt-0.5 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>已完成排定</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* ========================================================
             * Idle / Ready to Draw Screen
             * ======================================================== */
            <div className="space-y-4 max-w-xl mx-auto">
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-3xl bg-blue-50 border border-blue-100 flex items-center justify-center mx-auto text-blue-600 shadow-sm">
                <Zap className="w-7 h-7 sm:w-8 sm:h-8" />
              </div>

              <div className="space-y-1.5">
                <h2 className="text-2xl sm:text-4xl font-black text-slate-900 tracking-tight">
                  {currentPool.length === 0 ? '此範圍尚無專題' : undrawnPool.length === 0 ? '此範圍已完成抽籤' : '準備開始抽籤'}
                </h2>
                <p className="text-slate-500 text-xs sm:text-sm leading-relaxed">
                  {currentPool.length === 0
                    ? '請先在管理後台匯入專題資料，完成後即可在此進行抽籤。'
                    : undrawnPool.length === 0
                    ? '場次與報告順位已排定，請查看下方結果看板。'
                    : selectedField === 'ALL'
                    ? `全校共 ${domainConfigs.length} 個領域、${projects.length} 件專題。系統將依各領域之「組數」獨立分組排定報告順序。`
                    : `「${selectedField}」領域尚有 ${undrawnPool.length} 組尚未抽籤，將劃分 ${currentDomainConfig?.groupCount || 2} 組獨立排定。`}
                </p>
              </div>

              {/* Domains to be drawn preview */}
              <div className="flex flex-wrap items-center justify-center gap-1.5 pt-1">
                {(selectedField === 'ALL' ? domainConfigs : domainConfigs.filter((c) => c.field === selectedField)).map((c) => (
                  <span
                    key={c.id}
                    className="inline-flex items-center gap-1 text-[11px] font-medium bg-slate-100 text-slate-700 px-2.5 py-1 rounded-xl border border-slate-200"
                  >
                    <span>{c.field}</span>
                    <span className="text-slate-400 font-mono">({c.groupCount}組)</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Action Button: One-Click School-Wide Automatic Draw */}
        <div className="relative z-10 mt-6 sm:mt-8 pt-5 sm:pt-6 border-t border-slate-100 flex justify-center">
          <button
            onClick={handleOpenBatchModal}
            disabled={isAnimating || undrawnPool.length === 0}
            className="w-full sm:w-auto min-w-[260px] sm:min-w-[340px] px-8 py-4 rounded-2xl bg-blue-700 hover:bg-blue-800 text-white font-extrabold text-base sm:text-lg shadow-lg shadow-blue-500/20 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-40 disabled:hover:scale-100 disabled:shadow-none flex items-center justify-center gap-2.5 cursor-pointer"
          >
            <Zap className="w-5 h-5 fill-current shrink-0 animate-pulse" />
            <span>
              {selectedField === 'ALL'
                ? '開始全校抽籤'
                : `開始「${selectedField}」抽籤`}
            </span>
          </button>
        </div>
      </section>

      {/* ========================================================
       * Redesigned Order Board (清晰分組與順序時間軸看板)
       * ======================================================== */}
      <section className="bg-white rounded-[1.75rem] border border-slate-200 p-4 sm:p-7 lg:p-8 shadow-sm space-y-5" aria-label="已抽出順序看板">
        {/* Board Top Header & Controls */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-200">
          <div>
            <h3 className="text-lg sm:text-2xl font-black text-slate-900 flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0"><CheckCircle2 className="w-5 h-5" /></span>
              <span>分組與報告順序</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              依領域與場次排列；各組報告順位由第一位起算
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Quick Search Input */}
            <div className="relative min-w-[240px] sm:min-w-[280px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={boardSearchQuery}
                onChange={(e) => setBoardSearchQuery(e.target.value)}
                placeholder="搜尋專題名稱或抽籤編號"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-8 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all font-sans"
              />
              {boardSearchQuery && (
                <button
                  onClick={() => setBoardSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* View Switcher: Lanes vs Table */}
            <div className="inline-flex items-center p-0.5 rounded-xl bg-slate-100 border border-slate-200 text-xs">
              <button
                onClick={() => setBoardDisplayMode('lanes')}
                className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 cursor-pointer ${
                  boardDisplayMode === 'lanes'
                    ? 'bg-white text-rose-700 shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span>分組看板</span>
              </button>
              <button
                onClick={() => setBoardDisplayMode('table')}
                className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 cursor-pointer ${
                  boardDisplayMode === 'table'
                    ? 'bg-white text-rose-700 shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Table className="w-3.5 h-3.5" />
                <span>名單表格</span>
              </button>
            </div>
          </div>
        </div>

        {/* Quick Domain Filter Tabs (when viewing ALL domains) */}
        {selectedField === 'ALL' && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-2 px-2">
            <button
              onClick={() => setBoardDomainFilter('ALL')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer border ${
                boardDomainFilter === 'ALL'
                  ? 'bg-blue-700 text-white border-blue-700 shadow-xs'
                  : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
              }`}
            >
              全部領域 ({drawnPool.length} 組已抽)
            </button>
            {domainConfigs.map((cfg) => {
              const count = drawnPool.filter((p) => p.field === cfg.field).length;
              const total = projects.filter((p) => p.field === cfg.field).length;
              return (
                <button
                  key={cfg.id}
                  onClick={() => setBoardDomainFilter(cfg.field)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer border flex items-center gap-1.5 ${
                    boardDomainFilter === cfg.field
                      ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                      : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                  }`}
                >
                  <span>{cfg.field}</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                    boardDomainFilter === cfg.field ? 'bg-blue-700 text-white' : 'bg-slate-200 text-slate-600'
                  }`}>
                    {count}/{total}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Empty State */}
        {drawnPool.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-xs">
            尚無抽籤結果，請從上方主舞台開始抽籤。
          </div>
        ) : (
          /* Render Domains & Subgroups */
          <div className="space-y-8">
            {(selectedField === 'ALL'
              ? (boardDomainFilter === 'ALL' ? domainConfigs : domainConfigs.filter((c) => c.field === boardDomainFilter))
              : domainConfigs.filter((c) => c.field === selectedField)
            ).map((cfg) => {
              const domainDrawnProjects = drawnPool.filter((p) => p.field === cfg.field);
              if (domainDrawnProjects.length === 0) return null;

              const cleanQuery = boardSearchQuery.trim().toLowerCase();
              const isMatch = (item: ProjectItem) => {
                if (!cleanQuery) return false;
                return (
                  item.project_title.toLowerCase().includes(cleanQuery) ||
                  (item.draw_code && item.draw_code.toLowerCase().includes(cleanQuery))
                );
              };

              return (
                <div key={cfg.id} className="space-y-3.5">
                  {/* Domain Header Banner */}
                  <div className="flex flex-wrap items-center justify-between gap-2 p-4 sm:p-5 rounded-2xl border border-blue-200 bg-blue-50 text-slate-900">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-blue-600" />
                      <h4 className="text-base sm:text-lg font-black text-blue-950 tracking-tight">
                        {cfg.field}
                      </h4>
                      <span className="text-xs text-slate-600 font-mono">
                        (劃分 {cfg.groupCount} 組 · 已抽 {domainDrawnProjects.length} 件)
                      </span>
                    </div>
                    <span className="text-[11px] font-bold text-blue-800 bg-white px-2.5 py-1 rounded-full border border-blue-200">
                      各組獨立排序
                    </span>
                  </div>

                  {/* Lanes View (Columns per Subgroup) */}
                  {boardDisplayMode === 'lanes' ? (
                    <div
                      className={`grid gap-4 ${
                        cfg.groupCount === 1
                          ? 'grid-cols-1'
                          : cfg.groupCount === 2
                          ? 'grid-cols-1 md:grid-cols-2'
                          : cfg.groupCount === 3
                          ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
                          : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
                      }`}
                    >
                      {Array.from({ length: cfg.groupCount }, (_, i) => i + 1).map((g) => {
                        const groupItems = domainDrawnProjects
                          .filter((p) => p.assigned_group === g)
                          .sort((a, b) => (a.draw_order || 0) - (b.draw_order || 0));

                        return (
                          <div
                            key={g}
                            className="bg-slate-50/80 rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-3 flex flex-col"
                          >
                            {/* Subgroup Lane Header */}
                            <div className="flex items-center justify-between pb-2.5 border-b border-slate-200">
                              <div className="flex items-center gap-2">
                                <span className="w-7 h-7 rounded-lg bg-blue-600 text-white font-black text-xs flex items-center justify-center font-mono shadow-xs">
                                  {g}
                                </span>
                                <div>
                                  <div className="text-xs sm:text-sm font-black text-slate-900">
                                    第 {g} 組報告場次
                                  </div>
                                  <div className="text-[10px] text-slate-500 font-mono">
                                    發表順位 01 ~ {String(groupItems.length).padStart(2, '0')}
                                  </div>
                                </div>
                              </div>
                              <span className="text-[11px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200 font-mono">
                                共 {groupItems.length} 組
                              </span>
                            </div>

                            {/* Subgroup Items Ordered List */}
                            <div className="space-y-2 flex-1">
                              {groupItems.length === 0 ? (
                                <div className="text-center py-6 text-slate-400 text-xs">
                                  該組尚無資料
                                </div>
                              ) : (
                                groupItems.map((item) => {
                                  const matched = isMatch(item);

                                  return (
                                    <div
                                      key={item.id}
                                      className={`p-3.5 rounded-xl border transition-all text-left flex items-start gap-3 ${
                                        matched
                                          ? 'bg-blue-50/90 border-blue-400 ring-2 ring-blue-300 shadow-md scale-[1.01]'
                                          : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-xs'
                                      }`}
                                    >
                                      {/* Large Unmistakable Sequence Badge */}
                                      <div className="w-12 h-12 rounded-xl text-white flex flex-col items-center justify-center shrink-0 shadow-xs bg-gradient-to-br from-rose-500 to-rose-600 shadow-rose-200">
                                        <span className="text-[8px] font-semibold tracking-wider opacity-90 leading-none">
                                          順位
                                        </span>
                                        <span className="text-base font-black font-mono leading-none mt-0.5">
                                          {String(item.draw_order).padStart(2, '0')}
                                        </span>
                                      </div>

                                      {/* Project Details */}
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5 flex-wrap mb-1">
                                          <span className="text-[10px] font-bold font-mono text-rose-700 bg-rose-50 px-1.5 py-0.2 rounded border border-rose-200">
                                            {item.draw_code}
                                          </span>
                                          {matched && (
                                            <span className="text-[10px] font-bold text-blue-700 bg-blue-100 px-1.5 py-0.2 rounded animate-pulse">
                                              搜尋結果
                                            </span>
                                          )}
                                        </div>

                                        <h5
                                          className="text-sm font-bold text-slate-900 line-clamp-2 leading-snug"
                                          title={item.project_title}
                                        >
                                          {item.project_title}
                                        </h5>

                                      </div>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    /* Table View (Structured Table per Domain) */
                    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-xs">
                      <table className="w-full text-left text-xs sm:text-sm min-w-[500px]">
                        <thead>
                          <tr className="bg-blue-50 text-blue-950 text-xs font-semibold border-b border-blue-200">
                            <th className="py-2.5 px-3 whitespace-nowrap">報告順位</th>
                            <th className="py-2.5 px-3 whitespace-nowrap">分組場次</th>
                            <th className="py-2.5 px-3 whitespace-nowrap">抽籤編號</th>
                            <th className="py-2.5 px-3">專題名稱</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {domainDrawnProjects
                            .sort((a, b) => {
                              if (a.assigned_group !== b.assigned_group) {
                                return (a.assigned_group || 0) - (b.assigned_group || 0);
                              }
                              return (a.draw_order || 0) - (b.draw_order || 0);
                            })
                            .map((item) => {
                              const matched = isMatch(item);
                              return (
                                <tr
                                  key={item.id}
                                  className={`transition-colors ${
                                    matched
                                      ? 'bg-blue-50/90 font-semibold text-blue-900 border-l-4 border-blue-600'
                                      : 'hover:bg-slate-50 text-slate-700'
                                  }`}
                                >
                                  <td className="py-2.5 px-3 whitespace-nowrap">
                                    <span className="font-mono font-black text-rose-600 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                                      第 {String(item.draw_order).padStart(2, '0')} 位
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-3 whitespace-nowrap font-mono text-xs">
                                    <span className="font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">
                                      第 {item.assigned_group} 組
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-3 whitespace-nowrap font-mono text-xs font-bold text-slate-800">
                                    {item.draw_code}
                                  </td>
                                  <td className="py-2.5 px-3 max-w-xs sm:max-w-md truncate font-medium">
                                    {item.project_title}
                                    {matched && (
                                      <span className="ml-2 text-[10px] bg-blue-600 text-white px-1.5 py-0.2 rounded font-normal">
                                        相符
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* In-App Confirmation Modal for Batch Draw */}
      {isBatchModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-lg w-full p-6 sm:p-7 shadow-xl space-y-5">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100">
                  <Zap className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-slate-900">
                    啟動各領域獨立自動抽籤
                  </h3>
                  <p className="text-xs text-slate-500">
                    依各領域設定之組數獨立排定報告順序
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsBatchModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-2.5 text-xs text-slate-700 leading-relaxed">
              <div className="font-bold text-slate-900 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>抽籤規則說明：</span>
              </div>
              <ul className="list-disc list-inside space-y-1 text-slate-600">
                <li>
                  <strong>各領域獨立排序</strong>：每個領域依其設定的「分組組數」分別獨立產生順序（例如：第 1 組、第 2 組等各自從順序 01 起跳）。
                </li>
              </ul>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-1">
              <button
                onClick={() => setIsBatchModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={handleConfirmBatchDraw}
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-sm cursor-pointer flex items-center gap-1.5"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>確認開始抽籤</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Modal */}
      {isResetModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-md w-full p-6 shadow-xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0 border border-rose-100">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">確定重設抽籤結果？</h3>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  {selectedField === 'ALL'
                    ? '這將會清空「全校所有領域」已抽出的報告序位，所有專題組別將回到「未抽籤」狀態。'
                    : `這將會清空「${selectedField}」領域已抽出的報告序位。`}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                onClick={() => setIsResetModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium cursor-pointer"
              >
                取消保留
              </button>
              <button
                onClick={handleConfirmReset}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-sm cursor-pointer"
              >
                確定重設清空
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Notice Modal */}
      {noticeMessage && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-sm w-full p-6 text-center shadow-xl space-y-3">
            <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mx-auto border border-blue-100">
              <Sparkles className="w-5 h-5" />
            </div>
            <h4 className="text-sm font-bold text-slate-900">系統提示</h4>
            <p className="text-xs text-slate-600 leading-relaxed">{noticeMessage}</p>
            <div className="pt-2">
              <button
                onClick={() => setNoticeMessage(null)}
                className="w-full py-2 rounded-xl bg-blue-700 text-white text-xs font-semibold hover:bg-blue-800 cursor-pointer"
              >
                我知道了
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
