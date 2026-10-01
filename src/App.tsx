/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { ProjectItem, ViewMode, DomainConfig } from './types';
import { apiRequest, StoreState } from './lib/api';
import { Navbar } from './components/Navbar';
import { StudentPortal } from './components/StudentPortal';
import { StageLottery } from './components/StageLottery';
import { AdminManagement } from './components/AdminManagement';
import { AuthGate } from './components/AuthGate';
import {
  getAuthSession,
  clearAuthSession,
  saveAuthSession,
  hasPermissionForView,
  AuthSession,
} from './lib/auth';

// Helper to determine active view from URL path, hash, or query parameter
function getViewFromLocation(): ViewMode {
  if (typeof window === 'undefined') return 'student';

  const path = window.location.pathname.toLowerCase();
  const hash = window.location.hash.toLowerCase();
  const searchParams = new URLSearchParams(window.location.search);
  const queryView = searchParams.get('view')?.toLowerCase();

  if (queryView === 'admin' || queryView === 'stage' || queryView === 'student') {
    return queryView as ViewMode;
  }

  if (hash.includes('admin') || hash.includes('manage')) return 'admin';
  if (hash.includes('stage') || hash.includes('lottery')) return 'stage';
  if (hash.includes('student') || hash.includes('inquiry')) return 'student';

  if (path.includes('/admin') || path.includes('/manage')) return 'admin';
  if (path.includes('/stage') || path.includes('/lottery')) return 'stage';
  if (path.includes('/student') || path.includes('/inquiry')) return 'student';

  return 'student';
}

export default function App() {
  const [currentView, setCurrentView] = useState<ViewMode>(() => getViewFromLocation());
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [domainConfigs, setDomainConfigs] = useState<DomainConfig[]>([]);
  const [sharedPasswordEnabled, setSharedPasswordEnabled] = useState(false);
  const [dataVersion, setDataVersion] = useState<number | null>(null);
  const dataVersionRef = useRef<number | null>(null);
  const loadRequestIdRef = useRef(0);
  const [dataError, setDataError] = useState<string | null>(null);
  const [authSession, setAuthSession] = useState<AuthSession | null>(() => getAuthSession());

  const [authReady, setAuthReady] = useState(false);
  useEffect(() => {
    let active = true;
    apiRequest<{ session: AuthSession }>('/api/auth/me').then(data => {
      if (active) { saveAuthSession(data.session); setAuthSession(data.session); }
    }).catch(() => {}).finally(() => { if (active) setAuthReady(true); });
    return () => { active = false; };
  }, []);

  // Handle staff/admin logout
  const handleLogout = useCallback(async () => {
    try { await apiRequest('/api/auth/logout', {}); }
    catch (error) { setDataError(error instanceof Error ? error.message : '登出失敗，請重試'); return; }
    clearAuthSession();
    loadRequestIdRef.current++;
    setAuthSession(null);
    setProjects([]);
    setDomainConfigs([]);
    setSharedPasswordEnabled(false);
    dataVersionRef.current = null;
    setDataVersion(null);
    handleSelectView('student');
  }, []);

  // Navigate to view and update URL path and hash
  const handleSelectView = useCallback((view: ViewMode) => {
    setCurrentView(view);
    if (typeof window !== 'undefined') {
      const targetHash = `#/${view}`;
      const targetPath = `/${view}`;
      try {
        window.history.pushState({ view }, '', `${targetPath}${targetHash}`);
      } catch {
        window.location.hash = targetHash;
      }

      if (view === 'student') {
        document.title = '學生查榜 | 國立臺中科技大學專題成果展';
      } else if (view === 'stage') {
        document.title = '台上抽籤展演 | 國立臺中科技大學專題成果展';
      } else if (view === 'admin') {
        document.title = '管理後台 | 國立臺中科技大學專題成果展';
      }
    }
  }, []);

  // Listen to browser URL changes (back/forward and hash changes)
  useEffect(() => {
    const handleUrlChange = () => {
      const detected = getViewFromLocation();
      setCurrentView(detected);
    };

    window.addEventListener('popstate', handleUrlChange);
    window.addEventListener('hashchange', handleUrlChange);

    // Initial page title sync
    const initialView = getViewFromLocation();
    if (initialView === 'student') {
      document.title = '學生查榜 | 國立臺中科技大學專題成果展';
    } else if (initialView === 'stage') {
      document.title = '台上抽籤展演 | 國立臺中科技大學專題成果展';
    } else if (initialView === 'admin') {
      document.title = '管理後台 | 國立臺中科技大學專題成果展';
    }

    if (window.location.pathname === '/' && !window.location.hash) {
      try {
        window.history.replaceState({ view: initialView }, '', `/${initialView}#/${initialView}`);
      } catch {}
    }

    return () => {
      window.removeEventListener('popstate', handleUrlChange);
      window.removeEventListener('hashchange', handleUrlChange);
    };
  }, []);

  const applyState = (state: StoreState) => {
    // Keep the version and displayed data in the same snapshot. An older GET
    // response must not roll the UI back after a newer save has completed.
    if (dataVersionRef.current !== null && state.version < dataVersionRef.current) return;
    dataVersionRef.current = state.version;
    setDataVersion(state.version);
    setProjects(state.projects);
    setDomainConfigs(state.domainConfigs);
    setSharedPasswordEnabled(state.sharedPasswordEnabled);
    setDataError(null);
  };

  const loadData = useCallback(async () => {
    const requestId = ++loadRequestIdRef.current;
    if (!getAuthSession()) {
      setProjects([]);
      setDomainConfigs([]);
      setSharedPasswordEnabled(false);
      dataVersionRef.current = null;
      setDataVersion(null);
      setDataError(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const state = await apiRequest<StoreState>('/api/state');
      if (requestId === loadRequestIdRef.current && getAuthSession()) applyState(state);
    } catch (error) {
      if (requestId === loadRequestIdRef.current) setDataError(error instanceof Error ? error.message : '資料載入失敗');
    } finally {
      if (requestId === loadRequestIdRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData, authSession]);
  useEffect(() => {
    const expired = () => { loadRequestIdRef.current++; setAuthSession(null); setProjects([]); setDomainConfigs([]); setSharedPasswordEnabled(false); dataVersionRef.current = null; setDataVersion(null); };
    window.addEventListener('auth-expired', expired);
    return () => window.removeEventListener('auth-expired', expired);
  }, []);

  const handleSaveProjects = async (updated: ProjectItem[]) => {
    try {
      if (dataVersion === null) throw new Error('資料尚未載入，請重新整理。');
      applyState(await apiRequest('/api/projects', { projects: updated, version: dataVersion }));
    } catch (error) {
      setDataError(error instanceof Error ? error.message : '儲存失敗');
      throw error;
    }
  };

  const handleSharedPassword = async (action: 'generate' | 'clear') => {
    if (dataVersion === null) throw new Error('資料尚未載入，請重新整理。');
    const state = await apiRequest<StoreState & { password?: string }>('/api/student/shared-password', { action, version: dataVersion });
    applyState(state);
    return state.password;
  };

  const handleUpdateDomainConfigs = async (
    newConfigs: DomainConfig[],
    renamedField?: { oldName: string; newName: string }
  ) => {
    try {
      if (dataVersion === null) throw new Error('資料尚未載入，請重新整理。');
      applyState(await apiRequest('/api/domain-configs', { domainConfigs: newConfigs, renamedField, version: dataVersion }));
    } catch (error) {
      setDataError(error instanceof Error ? error.message : '儲存失敗');
      throw error;
    }
  };

  // Compute unique domain list based on current active domain configs
  const domainList = useMemo(() => {
    return domainConfigs.map((d) => d.field);
  }, [domainConfigs]);

  const drawnProjectsCount = useMemo(() => {
    return projects.filter((p) => !!p.draw_order).length;
  }, [projects]);

  if (!authReady) return <div className="p-8 text-center text-slate-500">正在載入後端登入狀態…</div>;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans selection:bg-rose-100 selection:text-rose-900">
      {/* Top Navigation */}
      <Navbar
        currentView={currentView}
        onSelectView={handleSelectView}
        totalProjects={projects.length}
        drawnProjectsCount={drawnProjectsCount}
        authSession={authSession}
        onLogout={handleLogout}
      />

      {/* Main Content Viewport */}
      <main className="flex-1 pb-16">
        {dataError && (
          <div role="alert" className="max-w-7xl mx-auto m-4 p-4 rounded-xl border border-red-200 bg-red-50 text-red-800">
            {dataError}
            <button className="ml-4 underline" onClick={() => void loadData()}>重新載入</button>
          </div>
        )}
        {isLoading && (projects.length === 0 || currentView !== 'student') ? (
          <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
            <div className="w-9 h-9 border-3 border-rose-100 border-t-rose-600 rounded-full animate-spin" />
            <p className="text-slate-500 text-xs">載入專題名冊與抽籤資料中...</p>
          </div>
        ) : (
          <>
            {currentView === 'student' && (
              <StudentPortal />
            )}

            {currentView === 'stage' && (
              !hasPermissionForView(authSession?.role || null, 'stage') ? (
                <AuthGate
                  targetView="stage"
                  onSuccess={(session) => {
                    setAuthSession(session);
                  }}
                  onCancel={() => handleSelectView('student')}
                />
              ) : (
                <StageLottery
                  projects={projects}
                  dataVersion={dataVersion}
                  onApplyState={applyState}
                  domainList={domainList}
                  domainConfigs={domainConfigs}
                />
              )
            )}

            {currentView === 'admin' && (
              !hasPermissionForView(authSession?.role || null, 'admin') ? (
                <AuthGate
                  targetView="admin"
                  onSuccess={(session) => {
                    setAuthSession(session);
                  }}
                  onCancel={() => handleSelectView('student')}
                />
              ) : (
                <AdminManagement
                  projects={projects}
                  dataVersion={dataVersion}
                  onSaveProjects={handleSaveProjects}
                  sharedPasswordEnabled={sharedPasswordEnabled}
                  onSharedPassword={handleSharedPassword}
                  domainList={domainList}
                  domainConfigs={domainConfigs}
                  onUpdateDomainConfigs={handleUpdateDomainConfigs}
                />
              )
            )}
          </>
        )}
      </main>

      {/* 國立臺中科技大學 版權宣告 */}
      <footer className="border-t border-slate-200/90 bg-slate-50/70 py-8 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col items-center justify-center space-y-1.5">
          <div className="text-slate-900 font-bold text-sm sm:text-base tracking-tight">
            國立臺中科技大學
          </div>
          <div className="text-slate-500 text-xs sm:text-sm font-medium tracking-wide">
            National Taichung University of Science and Technology
          </div>
          <div className="pt-2 text-slate-600 text-xs">
            © 2026 國立臺中科技大學 資訊與流通學院專題成果展
          </div>
        </div>
      </footer>
    </div>
  );
}
