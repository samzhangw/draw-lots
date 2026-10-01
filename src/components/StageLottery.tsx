import React, { useState, useEffect, useRef } from 'react';
import { ProjectItem, DomainConfig } from '../types';
import { soundManager } from '../lib/audio';
import { isAdvisorConflict } from '../lib/lottery';
import { getSecureRandomInt, securePickOne } from '../lib/cryptoRandom';
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
  onApplyState: (state: StoreState) => void;
  domainList: string[];
  domainConfigs: DomainConfig[];
}

export const StageLottery: React.FC<StageLotteryProps> = ({
  projects,
  onApplyState,
  domainList,
  domainConfigs,
}) => {
  const [selectedField, setSelectedField] = useState<string>('ALL');
  const [isAnimating, setIsAnimating] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Redesigned animation states
  const [animProgress, setAnimProgress] = useState<number>(0);
  const [animPhase, setAnimPhase] = useState<'shuffling' | 'verifying' | 'finalizing' | 'completed'>('shuffling');
  const [animActiveField, setAnimActiveField] = useState<string>('');
  const [animRollingTeam, setAnimRollingTeam] = useState<ProjectItem | null>(null);
  const [animRollingCode, setAnimRollingCode] = useState<string>('');
  const [animCompletedDomains, setAnimCompletedDomains] = useState<string[]>([]);
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

    setIsAnimating(true);
    setBatchDrawSummary(null);
    setAnimProgress(0);
    setAnimCompletedDomains([]);
    setAnimPhase('shuffling');

    const targetDomains = selectedField === 'ALL'
      ? domainConfigs
      : domainConfigs.filter((c) => c.field === selectedField);

    // Trigger backend draw calculation immediately on the server
    const backendDrawPromise = apiRequest<StoreState & { summary: string }>('/api/lottery/draw', {
      field: selectedField,
    }).then(result => ({ result, error: null }), error => ({ result: null, error }));

    let tick = 0;
    const totalTicks = 34; // approx 3.2 seconds of dramatic animation

    const intervalId = setInterval(() => {
      tick++;
      soundManager.playTick();

      // Progress percentage
      const progressPercent = Math.min(100, Math.round((tick / totalTicks) * 100));
      setAnimProgress(progressPercent);

      // Phase transitions
      if (tick < 12) {
        setAnimPhase('shuffling');
      } else if (tick < 26) {
        setAnimPhase('verifying');
      } else {
        setAnimPhase('finalizing');
      }

      // Cycle through active domains
      const currentDomainIdx = Math.floor((tick / totalTicks) * targetDomains.length) % targetDomains.length;
      const activeDomain = targetDomains[currentDomainIdx] || targetDomains[0];
      if (!activeDomain) {
        clearInterval(intervalId);
        void finalizeDrawExecution();
        return;
      }
      setAnimActiveField(activeDomain.field);

      // Pick a random team from undrawn pool to show rolling preview
      const candidate = securePickOne(undrawnPool) || undrawnPool[0];
      setAnimRollingTeam(candidate);

      // Simulated rolling order code
      const randGrp = getSecureRandomInt(activeDomain.groupCount || 2) + 1;
      const randSeq = String(getSecureRandomInt(20) + 1).padStart(2, '0');
      setAnimRollingCode(`${activeDomain.field.slice(0, 4)}-第${randGrp}組-序號${randSeq}`);

      // Sequentially mark domains as completed
      const completedCount = Math.floor((tick / totalTicks) * targetDomains.length);
      const completedList = targetDomains.slice(0, completedCount).map((d) => d.field);
      setAnimCompletedDomains(completedList);

      if (tick >= totalTicks) {
        clearInterval(intervalId);
        finalizeDrawExecution();
      }
    }, 95);

    const finalizeDrawExecution = async () => {
      try {
        // Await the backend calculation result returned in one single response
        const response = await backendDrawPromise;
        if (response.error) throw response.error;
        const backendResult = response.result;
        if (backendResult && Array.isArray(backendResult.projects)) {
          setBatchDrawSummary(
            backendResult.summary ||
              (selectedField === 'ALL'
                ? `【後端抽籤完成】全校共 ${domainConfigs.length} 個領域已由伺服器完成獨立分組抽籤！`
                : `【後端抽籤完成】「${selectedField}」領域已由伺服器完成獨立分組抽籤！`)
          );

          setAnimCompletedDomains(targetDomains.map((d) => d.field));
          setAnimProgress(100);
          setAnimPhase('completed');

          // Update projects state with the full backend response
          onApplyState(backendResult);
          setIsAnimating(false);

          soundManager.playGrandFanfare();
          triggerCelebration();
          return;
        }
        throw new Error('抽籤回應格式不正確。');
      } catch (apiErr) {
        setNoticeMessage(apiErr instanceof Error ? apiErr.message : '抽籤失敗，請重新整理後再試。');
        setIsAnimating(false);
      }
    };
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
    try {
      const data = await apiRequest('/api/lottery/reset', { field: selectedField });
      onApplyState(data);
      setBatchDrawSummary(null);
      setAnimRollingTeam(null);
      setAnimCompletedDomains([]);
    } catch (error) {
      setNoticeMessage(error instanceof Error ? error.message : '重設失敗，請稍後再試。');
    }
  };

  const completionPercent = currentPool.length > 0
    ? Math.round((drawnPool.length / currentPool.length) * 100)
    : 0;

  return (
    <div
      ref={stageContainerRef}
      className={`min-h-[calc(100vh-4rem)] bg-slate-50 text-slate-800 transition-all ${
        isFullscreen
          ? 'p-3 sm:p-6 fixed inset-0 z-50 overflow-y-auto bg-slate-50'
          : 'py-4 sm:py-8 px-3 sm:px-6 max-w-7xl mx-auto space-y-4 sm:space-y-6'
      }`}
    >
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 pb-3 sm:pb-4 border-b border-slate-200">
        <div className="flex items-center gap-2.5 sm:gap-3">
          <div className="h-10 sm:h-12 flex items-center justify-center shrink-0">
            <img
              src="https://cidsexhibition.nutc.edu.tw/images/logo.png"
              alt="國立臺中科技大學 資訊與流通學院"
              className="h-9 sm:h-11 w-auto object-contain"
            />
          </div>
          <div>
            <h1 className="text-lg sm:text-2xl font-black tracking-tight text-slate-900">
              台上抽籤展演大螢幕
            </h1>
            <p className="text-[11px] sm:text-xs text-slate-500">
              國立臺中科技大學 資訊與流通學院 · 各領域獨立分組抽籤
            </p>
          </div>
        </div>

        {/* Filter and Fullscreen */}
        <div className="flex items-center justify-between sm:justify-end gap-2 w-full sm:w-auto">
          <div className="flex-1 sm:flex-none flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 shadow-sm text-xs font-medium">
            <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <select
              value={selectedField}
              onChange={(e) => {
                setSelectedField(e.target.value);
                setBatchDrawSummary(null);
              }}
              className="w-full sm:w-auto bg-transparent text-slate-800 focus:outline-none cursor-pointer text-xs"
            >
              <option value="ALL">全體領域 ({projects.length} 組)</option>
              {domainConfigs.map((cfg) => {
                const count = projects.filter((p) => p.field === cfg.field).length;
                return (
                  <option key={cfg.id} value={cfg.field}>
                    {cfg.field} ({count} 件 · 分 {cfg.groupCount} 組)
                  </option>
                );
              })}
            </select>
          </div>

          <button
            onClick={toggleFullscreen}
            className="p-2 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-600 hover:text-slate-900 transition-colors shadow-sm cursor-pointer shrink-0"
            title={isFullscreen ? '退出全螢幕' : '全螢幕大螢幕投影'}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4 text-rose-600" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-3.5 sm:p-4 shadow-sm">
          <div className="text-[11px] sm:text-xs text-slate-500">當前抽籤領域範圍</div>
          <div className="text-sm sm:text-base font-bold text-slate-900 mt-0.5 truncate">
            {selectedField === 'ALL'
              ? `全校 ${domainConfigs.length} 個領域（各領域獨立分組）`
              : `${selectedField}（劃分 ${currentDomainConfig?.groupCount || 2} 組）`}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-3.5 sm:p-4 shadow-sm">
          <div className="flex justify-between items-center text-[11px] sm:text-xs text-slate-500 mb-1">
            <span>抽籤進度完成度</span>
            <span className="font-bold text-slate-900 font-mono">{completionPercent}%</span>
          </div>
          <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
            <div
              className="bg-rose-600 h-full transition-all duration-500 rounded-full"
              style={{ width: `${completionPercent}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] sm:text-[11px] text-slate-500 mt-1.5 font-mono">
            <span>已抽: {drawnPool.length} 組</span>
            <span>待抽: {undrawnPool.length} 組</span>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-3.5 sm:p-4 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-[11px] sm:text-xs text-slate-500">範圍內總件數</div>
            <div className="text-lg sm:text-xl font-black text-slate-900 mt-0.5 font-mono">{currentPool.length} 件</div>
          </div>
          <button
            onClick={handleOpenResetModal}
            disabled={isAnimating || drawnPool.length === 0}
            className="p-2 rounded-xl bg-slate-50 hover:bg-rose-50 text-slate-500 hover:text-rose-600 border border-slate-200 hover:border-rose-200 transition-colors disabled:opacity-30 cursor-pointer"
            title="重設此範圍抽籤結果"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Big Stage Presentation Card */}
      <div className="relative overflow-hidden rounded-3xl bg-white border border-slate-200 shadow-sm p-4 sm:p-8 md:p-10 text-center">
        {/* Dynamic Glow effects during animation */}
        {isAnimating && (
          <div className="absolute inset-0 bg-gradient-to-r from-blue-500/5 via-rose-500/10 to-amber-500/5 animate-pulse pointer-events-none" />
        )}

        <div className="relative z-10 max-w-4xl mx-auto min-h-[260px] sm:min-h-[300px] flex flex-col items-center justify-center">
          {isAnimating ? (
            /* ========================================================
             * Redesigned Multi-Phase Domain Lottery Animation
             * ======================================================== */
            <div className="space-y-5 sm:space-y-6 w-full animate-in fade-in duration-300">
              {/* Phase Step Badges */}
              <div className="flex flex-wrap items-center justify-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold border transition-all ${
                    animPhase === 'shuffling'
                      ? 'bg-rose-50 border-rose-300 text-rose-700 ring-2 ring-rose-200'
                      : 'bg-slate-100 border-slate-200 text-slate-500'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>步驟 1: 各領域獨立矩陣洗牌</span>
                </span>

                <span
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold border transition-all ${
                    animPhase === 'verifying'
                      ? 'bg-blue-50 border-blue-300 text-blue-700 ring-2 ring-blue-200'
                      : 'bg-slate-100 border-slate-200 text-slate-500'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>步驟 2: 各領域獨立隨機排序</span>
                </span>

                <span
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold border transition-all ${
                    animPhase === 'finalizing'
                      ? 'bg-amber-50 border-amber-300 text-amber-700 ring-2 ring-amber-200'
                      : 'bg-slate-100 border-slate-200 text-slate-500'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>步驟 3: 全校報告序號派定</span>
                </span>
              </div>

              {/* Real-time Progress Bar */}
              <div className="max-w-xl mx-auto w-full space-y-1.5">
                <div className="flex justify-between items-center text-xs text-slate-600 font-mono font-bold">
                  <span className="flex items-center gap-1 text-rose-600">
                    <Zap className="w-3.5 h-3.5 fill-current animate-bounce" />
                    <span>正在執行領域獨立抽籤中...</span>
                  </span>
                  <span>{animProgress}%</span>
                </div>
                <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden p-0.5 border border-slate-200">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-rose-500 via-blue-500 to-emerald-500 transition-all duration-100"
                    style={{ width: `${animProgress}%` }}
                  />
                </div>
              </div>

              {/* Dynamic Center Reel Card */}
              <div className="p-4 sm:p-6 bg-slate-900 text-white rounded-3xl border border-slate-800 shadow-xl max-w-2xl mx-auto w-full space-y-3">
                <div className="flex items-center justify-between text-[11px] sm:text-xs text-slate-400 font-mono">
                  <span className="px-2.5 py-0.5 rounded-full bg-slate-800 text-blue-400 border border-slate-700 font-bold">
                    當前運算領域：{animActiveField || '全校領域'}
                  </span>
                  <span className="text-emerald-400 font-semibold flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>序號狀態：即時產生中</span>
                  </span>
                </div>

                <div className="text-xl sm:text-3xl font-black text-rose-400 font-mono tracking-wider animate-pulse">
                  {animRollingCode || '領域-第1組-序號01'}
                </div>

                <div className="text-sm sm:text-base font-bold text-slate-100 line-clamp-1">
                  {animRollingTeam?.project_title || '隨機洗牌中...'}
                </div>

                <div className="text-[11px] text-slate-400">
                  指導老師: {animRollingTeam?.advisor || '---'} · 領域: {animRollingTeam?.field || '---'}
                </div>
              </div>

              {/* Real-time Domain Matrix Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-w-3xl mx-auto w-full pt-1">
                {domainConfigs.map((cfg) => {
                  const isDone = animCompletedDomains.includes(cfg.field);
                  const isCurrent = animActiveField === cfg.field;
                  const count = projects.filter((p) => p.field === cfg.field).length;

                  return (
                    <div
                      key={cfg.id}
                      className={`p-2.5 rounded-xl border text-left text-xs transition-all ${
                        isDone
                          ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                          : isCurrent
                          ? 'bg-blue-50 border-blue-400 text-blue-900 ring-2 ring-blue-200'
                          : 'bg-slate-50 border-slate-200 text-slate-500 opacity-60'
                      }`}
                    >
                      <div className="flex items-center justify-between font-bold text-[11px] truncate">
                        <span className="truncate">{cfg.field}</span>
                        {isDone ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        ) : isCurrent ? (
                          <div className="w-3 h-3 rounded-full border-2 border-blue-600 border-t-transparent animate-spin shrink-0" />
                        ) : null}
                      </div>
                      <div className="text-[10px] mt-1 text-slate-500">
                        {count} 件 · 分 {cfg.groupCount} 組
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : batchDrawSummary ? (
            /* ========================================================
             * Completed Screen
             * ======================================================== */
            <div className="space-y-4 sm:space-y-5 animate-in fade-in zoom-in duration-300 w-full">
              <div className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-emerald-50 text-emerald-700 text-xs font-bold border border-emerald-200 shadow-sm">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>全校各領域獨立分組抽籤已全數完成！</span>
              </div>

              <div className="text-2xl sm:text-4xl md:text-5xl font-black text-slate-900 tracking-tight">
                各領域報告序號已全數底定
              </div>

              <p className="text-xs sm:text-sm text-slate-600 max-w-2xl mx-auto leading-relaxed">
                {batchDrawSummary}
              </p>

              {/* Completed Domain Summary Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 max-w-3xl mx-auto w-full pt-2">
                {domainConfigs.map((cfg) => {
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
                <h2 className="text-xl sm:text-3xl font-black text-slate-900 tracking-tight">
                  {undrawnPool.length === 0 ? '該範圍所有組別已完成抽籤' : '準備抽籤：一鍵自動獨立排定'}
                </h2>
                <p className="text-slate-500 text-xs sm:text-sm leading-relaxed">
                  {undrawnPool.length === 0
                    ? '已全數完成分組序號抽選，可至管理後台匯出 Excel 結果。'
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
            className="w-full sm:w-auto min-w-[280px] sm:min-w-[340px] px-8 py-3.5 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-700 hover:via-indigo-700 hover:to-blue-800 text-white font-extrabold text-sm sm:text-base shadow-lg shadow-blue-500/25 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-40 disabled:hover:scale-100 disabled:shadow-none flex items-center justify-center gap-2.5 cursor-pointer"
          >
            <Zap className="w-5 h-5 fill-current shrink-0 animate-pulse" />
            <span>
              {selectedField === 'ALL'
                ? '一鍵全校自動抽籤 (各領域獨立分組)'
                : `一鍵抽出「${selectedField}」未抽組別`}
            </span>
          </button>
        </div>
      </div>

      {/* ========================================================
       * Redesigned Order Board (清晰分組與順序時間軸看板)
       * ======================================================== */}
      <div className="bg-white rounded-3xl border border-slate-200 p-4 sm:p-7 shadow-sm space-y-5">
        {/* Board Top Header & Controls */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <h3 className="text-base sm:text-lg font-black text-slate-900 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <span>已抽出順序看板（依分組與發表順位排序）</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              各領域各組別依獨立場次由「順序 01」起跳排列，點擊或搜尋可快速定位組別
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
                placeholder="輸入學號、專題、老師快速定位..."
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
                  ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
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
            目前尚未開出任何順序，請點擊上方按鈕啟動一鍵抽籤！
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
                  item.leader_id.toLowerCase().includes(cleanQuery) ||
                  item.project_title.toLowerCase().includes(cleanQuery) ||
                  item.advisor.toLowerCase().includes(cleanQuery) ||
                  (item.class_name && item.class_name.toLowerCase().includes(cleanQuery)) ||
                  (item.draw_code && item.draw_code.toLowerCase().includes(cleanQuery))
                );
              };

              return (
                <div key={cfg.id} className="space-y-3.5">
                  {/* Domain Header Banner */}
                  <div className="flex flex-wrap items-center justify-between gap-2 p-3 sm:p-3.5 rounded-2xl bg-slate-100/90 border border-slate-200">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-rose-600" />
                      <h4 className="text-sm sm:text-base font-black text-slate-900 tracking-tight">
                        {cfg.field}
                      </h4>
                      <span className="text-xs text-slate-500 font-mono">
                        (劃分 {cfg.groupCount} 組 · 已抽 {domainDrawnProjects.length} 件)
                      </span>
                    </div>
                    <span className="text-[11px] font-bold text-rose-700 bg-rose-50 px-2.5 py-0.5 rounded-full border border-rose-200">
                      各組獨立排序 · 由序號 01 起跳
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
                          : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5'
                      }`}
                    >
                      {Array.from({ length: cfg.groupCount }, (_, i) => i + 1).map((g) => {
                        const groupItems = domainDrawnProjects
                          .filter((p) => p.assigned_group === g)
                          .sort((a, b) => (a.draw_order || 0) - (b.draw_order || 0));

                        return (
                          <div
                            key={g}
                            className="bg-slate-50/80 rounded-2xl border border-slate-200 p-3 sm:p-4 space-y-3 flex flex-col"
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
                                      className={`p-3 rounded-xl border transition-all text-left flex items-start gap-2.5 ${
                                        matched
                                          ? 'bg-blue-50/90 border-blue-400 ring-2 ring-blue-300 shadow-md scale-[1.01]'
                                          : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-xs'
                                      }`}
                                    >
                                      {/* Large Unmistakable Sequence Badge */}
                                      <div className="w-11 h-11 rounded-xl text-white flex flex-col items-center justify-center shrink-0 shadow-xs bg-gradient-to-br from-rose-500 to-rose-600 shadow-rose-200">
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
                                              ⭐ 您的組別
                                            </span>
                                          )}
                                        </div>

                                        <h5
                                          className="text-xs font-bold text-slate-900 line-clamp-2 leading-snug"
                                          title={item.project_title}
                                        >
                                          {item.project_title}
                                        </h5>

                                        <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-500 mt-1.5 pt-1.5 border-t border-slate-100 gap-1">
                                          <span className="font-mono text-blue-700 font-semibold">
                                            {item.leader_id}
                                          </span>
                                          <span>{item.class_name}</span>
                                          <span>指導: {item.advisor}</span>
                                        </div>
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
                      <table className="w-full text-left text-xs sm:text-sm min-w-[650px]">
                        <thead>
                          <tr className="bg-slate-50 text-slate-600 text-xs font-semibold border-b border-slate-200">
                            <th className="py-2.5 px-3 whitespace-nowrap">報告順位</th>
                            <th className="py-2.5 px-3 whitespace-nowrap">分組場次</th>
                            <th className="py-2.5 px-3 whitespace-nowrap">+編號(抽籤後)</th>
                            <th className="py-2.5 px-3">專題名稱</th>
                            <th className="py-2.5 px-3 whitespace-nowrap">組長學號</th>
                            <th className="py-2.5 px-3 whitespace-nowrap">班級</th>
                            <th className="py-2.5 px-3 whitespace-nowrap">指導老師</th>
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
                                  <td className="py-2.5 px-3 whitespace-nowrap font-mono text-blue-700 font-semibold">
                                    {item.leader_id}
                                  </td>
                                  <td className="py-2.5 px-3 whitespace-nowrap text-slate-600">
                                    {item.class_name}
                                  </td>
                                  <td className="py-2.5 px-3 whitespace-nowrap text-slate-600 font-medium">
                                    {item.advisor}
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
      </div>

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
                className="w-full py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 cursor-pointer"
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
