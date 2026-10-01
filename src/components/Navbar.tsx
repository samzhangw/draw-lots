import React, { useState } from 'react';
import { ViewMode } from '../types';
import { AuthSession } from '../lib/auth';
import {
  Trophy,
  Dices,
  ShieldCheck,
  Volume2,
  VolumeX,
  Lock,
  LogOut,
  UserCheck
} from 'lucide-react';
import { soundManager } from '../lib/audio';

interface NavbarProps {
  currentView: ViewMode;
  onSelectView: (view: ViewMode) => void;
  totalProjects: number;
  drawnProjectsCount: number;
  authSession?: AuthSession | null;
  onLogout?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentView,
  onSelectView,
  totalProjects,
  drawnProjectsCount,
  authSession,
  onLogout,
}) => {
  const [soundOn, setSoundOn] = useState(soundManager.isSoundEnabled());

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    soundManager.setSoundEnabled(next);
  };

  const navItems = [
    {
      id: 'student' as ViewMode,
      href: '#/student',
      label: '學生查榜',
      shortLabel: '學生查榜',
      icon: Trophy,
      activeColor: 'text-blue-700 bg-white shadow-xs border-slate-200/90 font-bold',
      idleColor: 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50',
      iconActive: 'text-blue-600',
    },
    {
      id: 'stage' as ViewMode,
      href: '#/stage',
      label: '台上抽籤',
      shortLabel: '台上抽籤',
      icon: Dices,
      activeColor: 'text-rose-700 bg-white shadow-xs border-slate-200/90 font-bold',
      idleColor: 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50',
      iconActive: 'text-rose-600',
    },
    {
      id: 'admin' as ViewMode,
      href: '#/admin',
      label: '管理後台',
      shortLabel: '管理後台',
      icon: ShieldCheck,
      activeColor: 'text-emerald-800 bg-white shadow-xs border-slate-200/90 font-bold',
      idleColor: 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50',
      iconActive: 'text-emerald-600',
    },
  ];

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/90 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        
        {/* ========================================================= */}
        {/* DESKTOP & TABLET VIEW (md and above)                      */}
        {/* ========================================================= */}
        <div className="hidden md:flex items-center justify-between h-18 lg:h-20 gap-4">
          {/* Institutional Brand Identity */}
          <a
            href="#/student"
            onClick={(e) => {
              e.preventDefault();
              onSelectView('student');
            }}
            className="flex items-center gap-3 shrink-0 group focus:outline-hidden"
            title="國立臺中科技大學 資訊與流通學院 專題成果展"
          >
            {/* Academic Insignia Emblem / Official CIDS Exhibition Logo */}
            <div className="relative h-11 lg:h-12 flex items-center justify-center shrink-0 group-hover:scale-[1.02] transition-transform duration-200">
              <img
                src="https://cidsexhibition.nutc.edu.tw/images/logo.png"
                alt="國立臺中科技大學 資訊與流通學院"
                className="h-10 lg:h-11 w-auto object-contain"
                loading="eager"
              />
            </div>

            {/* Typographic Lockup */}
            <div className="flex flex-col justify-center">
              <div className="flex items-center gap-1.5 lg:gap-2">
                <span className="text-xs lg:text-sm font-semibold tracking-tight text-slate-500 uppercase font-sans">
                  國立臺中科技大學
                </span>
                <span className="text-slate-300" aria-hidden="true">/</span>
                <span className="text-xs lg:text-sm font-bold text-slate-700">
                  資訊與流通學院
                </span>
              </div>

              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="text-base lg:text-lg font-black tracking-tight text-slate-900 font-sans">
                  專題成果展
                </span>
                <span className="text-xs text-rose-700 font-semibold">
                  報告抽籤序位系統
                </span>
              </div>
            </div>
          </a>

          {/* Center Navigation Tabs */}
          <nav
            aria-label="主要功能選單"
            className="flex items-center p-1 bg-slate-100/90 rounded-2xl border border-slate-200/80"
          >
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentView === item.id;

              return (
                <a
                  key={item.id}
                  href={item.href}
                  onClick={(e) => {
                    e.preventDefault();
                    onSelectView(item.id);
                  }}
                  className={`relative flex items-center gap-2 px-3.5 py-2 lg:px-4 rounded-xl text-xs lg:text-sm font-semibold transition-all duration-150 cursor-pointer border ${
                    isActive
                      ? item.activeColor
                      : `border-transparent ${item.idleColor}`
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      isActive ? item.iconActive : 'text-slate-500'
                    }`}
                  />
                  <span>{item.label}</span>

                  {/* Lock Indicator for protected areas when not logged in */}
                  {(item.id === 'stage' || item.id === 'admin') && !authSession && (
                    <Lock className="w-3 h-3 text-slate-400 opacity-60 shrink-0 ml-0.5" />
                  )}

                  {/* Stage Monospace Counter */}
                  {item.id === 'stage' && drawnProjectsCount > 0 && (
                    <span className="hidden xl:inline text-[11px] font-mono font-medium text-rose-700 pl-0.5">
                      {drawnProjectsCount}/{totalProjects}
                    </span>
                  )}
                </a>
              );
            })}
          </nav>

          {/* Right Utilities */}
          <div className="flex items-center gap-2.5 shrink-0">
            {/* Authenticated Staff Status Badge & Logout */}
            {authSession && (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-100 border border-slate-200 text-xs">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                <span className="font-semibold text-slate-800 text-[11px] lg:text-xs">
                  {authSession.displayName}
                </span>
                {onLogout && (
                  <button
                    onClick={onLogout}
                    type="button"
                    className="ml-1 text-[11px] text-slate-500 hover:text-rose-600 font-medium cursor-pointer flex items-center gap-0.5"
                    title="登出目前授權"
                  >
                    <LogOut className="w-3 h-3" />
                    <span>登出</span>
                  </button>
                )}
              </div>
            )}

            {/* Audio Toggle */}
            <button
              onClick={toggleSound}
              type="button"
              title={soundOn ? '點擊靜音' : '點擊開啟抽籤音效'}
              aria-label={soundOn ? '點擊靜音' : '點擊開啟抽籤音效'}
              className="flex items-center gap-1.5 px-3 py-1.5 lg:py-2 rounded-xl bg-white hover:bg-slate-100/90 border border-slate-200 text-slate-700 text-xs font-medium transition-colors shadow-2xs cursor-pointer min-h-[38px]"
            >
              {soundOn ? (
                <Volume2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <VolumeX className="w-4 h-4 text-slate-400 shrink-0" />
              )}
              <span className="text-[11px] text-slate-600">
                {soundOn ? '音效開' : '靜音'}
              </span>
            </button>
          </div>
        </div>

        {/* ========================================================= */}
        {/* MOBILE VIEW (< md / 768px, phone-optimized layout)       */}
        {/* ========================================================= */}
        <div className="md:hidden py-2 space-y-2">
          {/* Mobile Top Row: Compact Brand & Right Utilities */}
          <div className="flex items-center justify-between gap-2">
            {/* Mobile Brand Link */}
            <a
              href="#/student"
              onClick={(e) => {
                e.preventDefault();
                onSelectView('student');
              }}
              className="flex items-center gap-2.5 min-w-0 group focus:outline-hidden"
            >
              <div className="h-8 flex items-center justify-center shrink-0">
                <img
                  src="https://cidsexhibition.nutc.edu.tw/images/logo.png"
                  alt="國立臺中科技大學 資訊與流通學院"
                  className="h-7 w-auto object-contain"
                  loading="eager"
                />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] text-slate-500 font-medium truncate leading-tight">
                  國立臺中科技大學 資訊與流通學院
                </div>
                <div className="text-xs font-black text-slate-900 truncate leading-tight mt-0.5">
                  專題成果展 <span className="font-medium text-rose-700">抽籤系統</span>
                </div>
              </div>
            </a>

            {/* Mobile Right Controls: Logout & Audio Toggle */}
            <div className="flex items-center gap-1.5 shrink-0">
              {authSession && onLogout && (
                <button
                  onClick={onLogout}
                  type="button"
                  title="登出目前授權"
                  aria-label="登出目前授權"
                  className="flex items-center justify-center gap-1 px-2 h-8 rounded-lg bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-600 border border-slate-200 text-xs font-semibold cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span className="text-[10px]">登出</span>
                </button>
              )}

              <button
                onClick={toggleSound}
                type="button"
                title={soundOn ? '點擊靜音' : '點擊開啟音效'}
                aria-label={soundOn ? '點擊靜音' : '點擊開啟音效'}
                className="flex items-center justify-center w-8 h-8 rounded-lg bg-slate-100 active:bg-slate-200 border border-slate-200 text-slate-700 cursor-pointer"
              >
                {soundOn ? (
                  <Volume2 className="w-4 h-4 text-emerald-600" />
                ) : (
                  <VolumeX className="w-4 h-4 text-slate-400" />
                )}
              </button>
            </div>
          </div>

          {/* Mobile Bottom Row: Full-Width 3-Column Tab Bar */}
          <nav
            aria-label="主要功能選單 (行動版)"
            className="grid grid-cols-3 gap-1 p-1 bg-slate-100/95 rounded-xl border border-slate-200/80"
          >
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentView === item.id;

              return (
                <a
                  key={item.id}
                  href={item.href}
                  onClick={(e) => {
                    e.preventDefault();
                    onSelectView(item.id);
                  }}
                  className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all duration-150 cursor-pointer border min-h-[38px] ${
                    isActive
                      ? item.activeColor
                      : `border-transparent ${item.idleColor}`
                  }`}
                >
                  <Icon
                    className={`w-3.5 h-3.5 shrink-0 ${
                      isActive ? item.iconActive : 'text-slate-500'
                    }`}
                  />
                  <span>{item.shortLabel}</span>
                  {(item.id === 'stage' || item.id === 'admin') && !authSession && (
                    <Lock className="w-2.5 h-2.5 text-slate-400 opacity-60 shrink-0" />
                  )}
                </a>
              );
            })}
          </nav>
        </div>

      </div>
    </header>
  );
};
