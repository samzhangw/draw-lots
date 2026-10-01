import React, { useState, useRef } from 'react';
import { ProjectItem, DomainStats, DomainConfig } from '../types';
import { parseExcelFile, preserveImportedProjectIds, exportToExcel, downloadInputTemplate, REQUIRED_INPUT_HEADERS, REQUIRED_OUTPUT_HEADERS } from '../lib/excel';
import { isAdvisorConflict, normalizeProfessorName } from '../lib/lottery';
import { useModalFocus } from '../lib/useModalFocus';
import {
  Upload,
  Download,
  FileSpreadsheet,
  Plus,
  Trash2,
  Edit,
  Search,
  Filter,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Info,
  X,
  Settings2,
  FolderPlus,
  UserCheck,
  ShieldCheck,
  Users
} from 'lucide-react';

interface AdminManagementProps {
  projects: ProjectItem[];
  dataVersion: number | null;
  onSaveProjects: (updated: ProjectItem[]) => Promise<void>;
  sharedPasswordEnabled: boolean;
  onSharedPassword: (action: 'generate' | 'clear') => Promise<string | undefined>;
  domainList: string[];
  domainConfigs: DomainConfig[];
  onUpdateDomainConfigs: (configs: DomainConfig[], renamedField?: { oldName: string; newName: string }) => Promise<void>;
}

export const AdminManagement: React.FC<AdminManagementProps> = ({
  projects,
  dataVersion,
  onSaveProjects,
  sharedPasswordEnabled,
  onSharedPassword,
  domainList,
  domainConfigs,
  onUpdateDomainConfigs,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedFieldFilter, setSelectedFieldFilter] = useState<string>('ALL');
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadFeedback, setUploadFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [adminProjectDisplayMode, setAdminProjectDisplayMode] = useState<'table' | 'cards'>('table');
  const [sharedAction, setSharedAction] = useState<'generate' | 'clear' | null>(null);
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(null);
  const [sharedSaving, setSharedSaving] = useState(false);
  const [passwordCopied, setPasswordCopied] = useState(false);
  const draftVersionRef = useRef<number | null>(dataVersion);

  const submitSharedAction = async () => {
    if (!sharedAction || sharedSaving) return;
    setSharedSaving(true);
    try {
      const password = await onSharedPassword(sharedAction);
      setSharedAction(null);
      setGeneratedPassword(password || null);
      setPasswordCopied(false);
      setUploadFeedback({ type: 'success', message: password ? '全體共用密碼已更新。請複製並安全發送給學生。' : '共用密碼已停用，請為學生重新設定個別密碼。' });
    } catch (error) {
      setUploadFeedback({ type: 'error', message: error instanceof Error ? error.message : '共用密碼設定失敗' });
    } finally { setSharedSaving(false); }
  };

  const withSaveFeedback = <Args extends unknown[]>(action: (...args: Args) => Promise<void>) =>
    async (...args: Args) => {
      if (draftIsStale) {
        setUploadFeedback({ type: 'error', message: '其他裝置或操作已更新資料。請先關閉舊編輯視窗，再從最新資料重新開啟。' });
        return;
      }
      try { await action(...args); }
      catch (error) {
        setUploadFeedback({ type: 'error', message: error instanceof Error ? error.message : '儲存失敗' });
      }
    };

  // In-app modals for file import & delete confirmation
  const [pendingImportProjects, setPendingImportProjects] = useState<ProjectItem[] | null>(null);
  const [overwriteAcknowledged, setOverwriteAcknowledged] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<{ id: string; title: string } | null>(null);

  // Edit / Add Project modal state
  const [editingProject, setEditingProject] = useState<ProjectItem | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [formValidationNotice, setFormValidationNotice] = useState<string | null>(null);

  // Edit / Add Domain modal state
  const [isDomainModalOpen, setIsDomainModalOpen] = useState<boolean>(false);
  const [editingDomain, setEditingDomain] = useState<DomainConfig | null>(null);
  const [domainToDelete, setDomainToDelete] = useState<DomainConfig | null>(null);
  const [domainFormName, setDomainFormName] = useState<string>('');
  const [domainFormGroupCount, setDomainFormGroupCount] = useState<number>(2);
  const [domainFormError, setDomainFormError] = useState<string | null>(null);

  // Evaluators (Reviewer Professors) Modal State
  const [isEvaluatorModalOpen, setIsEvaluatorModalOpen] = useState<boolean>(false);
  const [domainForEvaluators, setDomainForEvaluators] = useState<DomainConfig | null>(null);
  const [evaluatorDrafts, setEvaluatorDrafts] = useState<Record<number, string>>({});

  // Direct group count input drafts per domain
  const [groupCountInputs, setGroupCountInputs] = useState<Record<string, string>>({});

  const draftOpen = !!(pendingImportProjects || projectToDelete || editingProject || isAddModalOpen || isDomainModalOpen || domainToDelete || isEvaluatorModalOpen);
  const draftIsStale = draftOpen && draftVersionRef.current !== dataVersion;
  const beginDraft = () => { draftVersionRef.current = dataVersion; };

  // Form state for project add/edit
  const [formData, setFormData] = useState<Partial<ProjectItem>>({
    education_system: '日間部四技',
    department: '資訊管理系',
    class_name: '資管四甲',
    advisor: '',
    field: domainList[0] || '企業智慧化',
    original_code: '',
    project_title: '',
    leader_id: '',
    password: '',
    draw_code: '',
  });

  // Calculate live domain statistics dynamically
  const statsMap: Record<string, number> = Object.create(null);
  projects.forEach((p) => {
    statsMap[p.field] = (statsMap[p.field] || 0) + 1;
  });

  // Derived statistics linked directly with customizable domainConfigs
  const domainStatsDisplay: (DomainStats & { id: string; evaluatorsPerGroup?: Record<number, string[]> })[] = domainConfigs.map((cfg) => {
    return {
      id: cfg.id,
      field: cfg.field,
      count: statsMap[cfg.field] || 0,
      groupCount: cfg.groupCount,
      evaluatorsPerGroup: cfg.evaluatorsPerGroup,
    };
  });

  const totalProjectsCount = projects.length;
  const totalGroupCount = domainStatsDisplay.reduce((acc, curr) => acc + curr.groupCount, 0);

  // Filtered projects
  const filteredProjects = projects.filter((p) => {
    const matchesField = selectedFieldFilter === 'ALL' || p.field === selectedFieldFilter;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return matchesField;
    const matchesSearch =
      p.project_title.toLowerCase().includes(q) ||
      p.leader_id.toLowerCase().includes(q) ||
      p.original_code.toLowerCase().includes(q) ||
      p.advisor.toLowerCase().includes(q) ||
      p.class_name.toLowerCase().includes(q) ||
      (p.draw_code && p.draw_code.toLowerCase().includes(q));
    return matchesField && matchesSearch;
  });

  // Open modal to Add Domain
  const handleOpenAddDomain = () => {
    beginDraft();
    setEditingDomain(null);
    setDomainFormName('');
    setDomainFormGroupCount(2);
    setDomainFormError(null);
    setIsDomainModalOpen(true);
  };

  // Open modal to Edit Domain
  const handleOpenEditDomain = (cfg: DomainConfig) => {
    beginDraft();
    setEditingDomain(cfg);
    setDomainFormName(cfg.field);
    setDomainFormGroupCount(cfg.groupCount);
    setDomainFormError(null);
    setIsDomainModalOpen(true);
  };

  // Open Evaluator modal for a specific domain
  const handleOpenEvaluatorModal = (cfg: DomainConfig) => {
    beginDraft();
    setDomainForEvaluators(cfg);
    const drafts: Record<number, string> = {};
    for (let g = 1; g <= cfg.groupCount; g++) {
      const list = cfg.evaluatorsPerGroup?.[g] || [];
      drafts[g] = list.join('、');
    }
    setEvaluatorDrafts(drafts);
    setIsEvaluatorModalOpen(true);
  };

  // Save Evaluators for Domain
  const handleSaveEvaluators = withSaveFeedback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!domainForEvaluators) return;

    const parsedEvaluators: Record<number, string[]> = {};
    for (let g = 1; g <= domainForEvaluators.groupCount; g++) {
      const raw = evaluatorDrafts[g] || '';
      const list = raw
        .split(/[、,，\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      parsedEvaluators[g] = list;
    }

    const updatedConfigs = domainConfigs.map((c) =>
      c.id === domainForEvaluators.id
        ? { ...c, evaluatorsPerGroup: parsedEvaluators }
        : c
    );

    await onUpdateDomainConfigs(updatedConfigs);

    setUploadFeedback({
      type: 'success',
      message: `成功更新「${domainForEvaluators.field}」之各組評審委員名冊！`,
    });

    setIsEvaluatorModalOpen(false);
  });

  // Save Domain (Add or Edit)
  const handleSaveDomain = withSaveFeedback(async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = domainFormName.trim();
    if (!cleanName) {
      setDomainFormError('請輸入領域名稱！');
      return;
    }
    if (domainFormGroupCount < 1) {
      setDomainFormError('分組組數至少須為 1 組！');
      return;
    }

    if (editingDomain) {
      const duplicate = domainConfigs.find(
        (c) => c.id !== editingDomain.id && c.field.toLowerCase() === cleanName.toLowerCase()
      );
      if (duplicate) {
        setDomainFormError(`已存在相同名稱的領域「${cleanName}」！`);
        return;
      }

      const isRenamed = editingDomain.field !== cleanName;
      const oldName = editingDomain.field;

      const updatedConfigs = domainConfigs.map((c) =>
        c.id === editingDomain.id
          ? { ...c, field: cleanName, groupCount: Number(domainFormGroupCount) }
          : c
      );

      await onUpdateDomainConfigs(
        updatedConfigs,
        isRenamed ? { oldName, newName: cleanName } : undefined
      );

      setUploadFeedback({
        type: 'success',
        message: `成功更新領域「${cleanName}」（組數: ${domainFormGroupCount} 組）${
          isRenamed ? `，並同步更新原「${oldName}」之專題資料` : ''
        }！`,
      });
    } else {
      const duplicate = domainConfigs.find(
        (c) => c.field.toLowerCase() === cleanName.toLowerCase()
      );
      if (duplicate) {
        setDomainFormError(`已存在相同名稱的領域「${cleanName}」！`);
        return;
      }

      const newDomain: DomainConfig = {
        id: `domain-${Date.now()}`,
        field: cleanName,
        groupCount: Number(domainFormGroupCount),
        evaluatorsPerGroup: {},
      };

      const updatedConfigs = [...domainConfigs, newDomain];
      await onUpdateDomainConfigs(updatedConfigs);

      setUploadFeedback({
        type: 'success',
        message: `成功新增專題展覽領域「${cleanName}」（分組數: ${domainFormGroupCount} 組）！`,
      });
    }

    setIsDomainModalOpen(false);
  });

  // Direct set group count from numeric input
  const handleDirectSetGroupCount = withSaveFeedback(async (id: string, newCount: number) => {
    const clamped = Math.max(1, Math.min(50, Math.floor(newCount) || 1));
    const updated = domainConfigs.map((c) => {
      if (c.id === id) {
        return { ...c, groupCount: clamped };
      }
      return c;
    });
    await onUpdateDomainConfigs(updated);
  });

  // Quick adjust group count directly (+ / -)
  const handleQuickAdjustGroupCount = withSaveFeedback(async (id: string, delta: number) => {
    const updated = domainConfigs.map((c) => {
      if (c.id === id) {
        const next = Math.max(1, Math.min(50, c.groupCount + delta));
        return { ...c, groupCount: next };
      }
      return c;
    });
    setGroupCountInputs((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    await onUpdateDomainConfigs(updated);
  });

  // Delete Domain
  const handleConfirmDeleteDomain = withSaveFeedback(async () => {
    if (!domainToDelete) return;

    const remainingConfigs = domainConfigs.filter((c) => c.id !== domainToDelete.id);
    const affectedCount = statsMap[domainToDelete.field] || 0;

    await onUpdateDomainConfigs(remainingConfigs);

    setUploadFeedback({
      type: 'success',
      message: `已刪除領域「${domainToDelete.field}」${
        affectedCount > 0 ? `，原 ${affectedCount} 筆專題已移至「${remainingConfigs[0]?.field || '未分類領域'}」` : ''
      }。`,
    });

    setDomainToDelete(null);
  });

  // Handle Excel upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadFeedback(null);

    const result = await parseExcelFile(file);

    if (result.success && result.projects) {
      beginDraft();
      setPendingImportProjects(result.projects);
      setOverwriteAcknowledged(false);
    } else {
      setUploadFeedback({
        type: 'error',
        message: result.error || '讀取 Excel 失敗，請確認檔案格式',
      });
    }

    setIsUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Confirm import mode (Overwrite or Append)
  const handleApplyImport = withSaveFeedback(async (mode: 'overwrite' | 'append') => {
    if (!pendingImportProjects) return;

    let finalProjects: ProjectItem[] = [];
    if (mode === 'overwrite') {
      if (projects.some(p => p.draw_order) && !overwriteAcknowledged) {
        setUploadFeedback({ type: 'error', message: '名冊已有抽籤結果，請先勾選確認覆蓋風險。' });
        return;
      }
      finalProjects = preserveImportedProjectIds(pendingImportProjects, projects);
    } else {
      const existingLeaderIds = new Set(projects.map((p) => p.leader_id.trim().toLowerCase()));
      const newAdditions = pendingImportProjects.filter(
        (p) => !existingLeaderIds.has(p.leader_id.trim().toLowerCase())
      );
      finalProjects = [...projects, ...newAdditions];
    }

    if (sharedPasswordEnabled) finalProjects = finalProjects.map(({ password: _password, ...p }) => p as ProjectItem);
    await onSaveProjects(finalProjects);
    setUploadFeedback({
      type: 'success',
      message: `成功更新專題名冊！目前名冊共計 ${finalProjects.length} 筆，資料已即時寫入系統。`,
    });
    setPendingImportProjects(null);
    setOverwriteAcknowledged(false);
  });

  // Export Excel
  const handleExport = () => {
    exportToExcel(projects, '台中科技大學專題展報告抽籤結果');
  };

  // Confirm project deletion
  const handleConfirmDelete = withSaveFeedback(async () => {
    if (!projectToDelete) return;
    const updated = projects.filter((p) => p.id !== projectToDelete.id);
    await onSaveProjects(updated);
    setProjectToDelete(null);
  });

  // Open edit modal for project
  const handleStartEdit = (p: ProjectItem) => {
    beginDraft();
    setEditingProject(p);
    setFormData({
      ...p,
      password: '',
    });
    setFormValidationNotice(null);
  };

  // Open add project modal
  const handleOpenAddProject = () => {
    beginDraft();
    setEditingProject(null);
    setFormData({
      education_system: '日間部四技',
      department: '資訊管理系',
      class_name: '資管四甲',
      advisor: '',
      field: domainList[0] || '企業智慧化',
      original_code: '',
      project_title: '',
      leader_id: '',
      draw_code: '',
    });
    setFormValidationNotice(null);
    setIsAddModalOpen(true);
  };

  // Submit edit or add project
  const handleSaveModal = withSaveFeedback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.project_title || !formData.leader_id) {
      setFormValidationNotice('請填寫專題名稱與組長學號！');
      return;
    }

    const cleanLeaderId = formData.leader_id.trim();
    const finalPassword = sharedPasswordEnabled ? '' : formData.password || '';
    if (finalPassword && (finalPassword.trim().length < 12 || finalPassword.length > 128 || finalPassword === cleanLeaderId)) {
      setFormValidationNotice('新密碼須為 12 至 128 字元，且不可使用學號。');
      return;
    }

    let updatedList: ProjectItem[];

    if (editingProject) {
      updatedList = projects.map((p) => {
        if (p.id === editingProject.id) {
          return {
            ...p,
            ...formData,
            leader_id: cleanLeaderId,
            password: finalPassword,
            draw_order: formData.draw_code ? parseInt(String(formData.draw_code).replace(/\D/g, ''), 10) || p.draw_order : p.draw_order,
          } as ProjectItem;
        }
        return p;
      });
    } else {
      const nextSeq = String(projects.length + 1);
      const newProj: ProjectItem = {
        id: `manual-${Date.now()}`,
        seq_no: formData.seq_no || nextSeq,
        education_system: formData.education_system || '日間部四技',
        department: formData.department || '資訊管理系',
        class_name: formData.class_name || '資管四甲',
        advisor: formData.advisor || '專題指導老師',
        field: formData.field || domainList[0] || '企業智慧化',
        original_code: formData.original_code || `P-${nextSeq}`,
        project_title: formData.project_title,
        leader_id: cleanLeaderId,
        password: finalPassword,
        draw_order: formData.draw_code ? parseInt(String(formData.draw_code).replace(/\D/g, ''), 10) || null : null,
        draw_code: formData.draw_code || null,
        draw_time: formData.draw_code ? new Date().toISOString() : null,
      };
      updatedList = [...projects, newProj];
    }

    await onSaveProjects(updatedList);
    setEditingProject(null);
    setIsAddModalOpen(false);
  });

  const activeModalKey = sharedAction ? 'shared-action' : generatedPassword ? 'shared-password'
    : isEvaluatorModalOpen ? 'evaluators' : isDomainModalOpen ? 'domain'
    : domainToDelete ? 'delete-domain' : pendingImportProjects ? 'import'
    : projectToDelete ? 'delete-project' : (isAddModalOpen || editingProject) ? 'project' : null;
  useModalFocus(activeModalKey, () => {
    if (sharedAction) { if (!sharedSaving) setSharedAction(null); }
    else if (generatedPassword) { setGeneratedPassword(null); setPasswordCopied(false); }
    else if (isEvaluatorModalOpen) setIsEvaluatorModalOpen(false);
    else if (isDomainModalOpen) setIsDomainModalOpen(false);
    else if (domainToDelete) setDomainToDelete(null);
    else if (pendingImportProjects) setPendingImportProjects(null);
    else if (projectToDelete) setProjectToDelete(null);
    else { setEditingProject(null); setIsAddModalOpen(false); }
  });

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 sm:px-6 space-y-6">
      {draftIsStale && <div role="alert" className="fixed top-3 left-3 right-3 z-[60] mx-auto max-w-xl rounded-xl border border-amber-400 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950 shadow-lg">
        資料已在其他裝置或操作中更新。這份草稿已過期，無法儲存；可先複製已輸入內容，再關閉視窗並以最新資料重新編輯。
      </div>}
      {/* Title & Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2">
        <div className="flex items-center gap-3">
          <img
            src="https://cidsexhibition.nutc.edu.tw/images/logo.png"
            alt="國立臺中科技大學 資訊與流通學院"
            className="h-10 sm:h-11 w-auto object-contain shrink-0"
          />
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900">
              專題抽籤管理員後台
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              各領域獨立分組 · 各組評審委員名冊 · Excel 匯入/匯出
            </p>
          </div>
        </div>

        {/* Action Controls: Excel Batch Center & Manual Add */}
        <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
          {/* Excel Batch Operations Group */}
          <div className="inline-flex items-center p-1 bg-slate-100/90 rounded-2xl border border-slate-200/90 gap-1.5 shadow-2xs">
            <button
              onClick={downloadInputTemplate}
              className="px-3 py-1.5 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer"
              title="下載標準 Excel 名冊匯入範本"
            >
              <Download className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <span>下載匯入範本</span>
            </button>

            <input
              type="file"
              aria-label="選擇專題名冊檔案"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept=".xlsx, .xls, .csv"
              className="hidden"
            />

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
              title="隨時匯入或覆蓋專題名冊"
            >
              <Upload className="w-3.5 h-3.5 shrink-0" />
              <span>{isUploading ? '讀取中...' : '匯入 Excel 名冊'}</span>
            </button>

            <button
              onClick={handleExport}
              className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              title="匯出含 [+抽籤結果編號] 的 Excel 名冊"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" />
              <span>匯出結果 Excel</span>
            </button>
          </div>

          {/* Quick Manual Add Button */}
          <button
            onClick={handleOpenAddProject}
            className="px-3.5 py-2 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer"
            title="手動新增單一專題"
          >
            <Plus className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>手動新增專題</span>
          </button>
          <button
            onClick={() => setSharedAction('generate')}
            disabled={!projects.length || sharedSaving}
            className="px-3.5 py-2 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            {sharedPasswordEnabled ? '重新產生共用密碼' : '產生全體共用密碼'}
          </button>
          {sharedPasswordEnabled && <button onClick={() => setSharedAction('clear')} className="px-3.5 py-2 rounded-2xl border border-slate-300 text-slate-700 text-xs font-bold cursor-pointer">停用共用密碼</button>}
        </div>
      </div>

      {sharedAction && <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="確認共用密碼操作">
        <div className="bg-white rounded-2xl p-6 max-w-md w-full space-y-4 shadow-xl">
          <h2 className="text-lg font-bold">{sharedAction === 'generate' ? '產生全體共用密碼？' : '停用全體共用密碼？'}</h2>
          <p className="text-sm text-slate-700">{sharedAction === 'generate' ? '系統會產生一組 8 碼隨機英數密碼，取代所有學生目前的密碼並讓現有登入失效。新密碼只會顯示一次。知道其他組長學號的人也能用共用密碼查詢該組的專題名稱與抽籤結果；班級、指導老師等其他名冊資料不會顯示。' : '停用後所有學生都無法登入，直到管理員分別設定個別密碼。'}</p>
          <div className="flex justify-end gap-2"><button onClick={() => setSharedAction(null)} disabled={sharedSaving} className="px-4 py-2 rounded-lg border">取消</button><button onClick={() => void submitSharedAction()} disabled={sharedSaving} className="px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold disabled:opacity-50">{sharedSaving ? '處理中…' : '確認'}</button></div>
        </div>
      </div>}
      {generatedPassword && <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="新共用密碼">
        <div className="bg-white rounded-2xl p-6 max-w-md w-full space-y-4 shadow-xl">
          <h2 className="text-lg font-bold">全體共用密碼已產生</h2>
          <p className="text-sm text-slate-700">請立即複製並安全發送給學生。關閉後無法再次查看；重新產生會讓舊密碼失效。</p>
          <output className="block p-3 rounded-lg bg-slate-100 font-mono break-all select-all" aria-label="共用密碼">{generatedPassword}</output>
          <div className="flex justify-end gap-2"><button onClick={() => { setGeneratedPassword(null); setPasswordCopied(false); }} className="px-4 py-2 rounded-lg border">關閉</button><button onClick={() => { void navigator.clipboard.writeText(generatedPassword).then(() => setPasswordCopied(true)).catch(() => setUploadFeedback({ type: 'error', message: '複製失敗，請手動選取密碼。' })); }} className="px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold">{passwordCopied ? '已複製' : '複製密碼'}</button></div>
        </div>
      </div>}

      {/* Feedback Alert */}
      {uploadFeedback && (
        <div
          role={uploadFeedback.type === 'error' ? 'alert' : 'status'}
          className={`p-3.5 rounded-2xl border flex items-start gap-2.5 text-xs sm:text-sm ${
            uploadFeedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          {uploadFeedback.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
          )}
          <div className="flex-1 whitespace-pre-line">{uploadFeedback.message}</div>
          <button
            onClick={() => setUploadFeedback(null)}
            aria-label="關閉提示"
            className="text-slate-400 hover:text-slate-700 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Domain & Group Count Pivot Table */}
      <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200 p-4 sm:p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 mb-4 sm:mb-6">
          <div>
            <h2 className="text-sm sm:text-base font-bold text-slate-900 flex items-center gap-2">
              <Layers className="w-4 h-4 text-rose-600 shrink-0" />
              <span>專題展領域、分組數與評審委員設定</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              各領域可自訂分組組數與各組評審委員名單。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleOpenAddDomain}
              className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 active:bg-black text-white text-xs font-semibold shadow-2xs flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <FolderPlus className="w-3.5 h-3.5 text-amber-300" />
              <span>新增展覽領域</span>
            </button>
            <div className="text-xs text-slate-600 bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200 font-mono">
              總計：<strong className="text-slate-900 font-bold">{totalProjectsCount}</strong> 件 · <strong className="text-slate-900 font-bold">{totalGroupCount}</strong> 組
            </div>
          </div>
        </div>

        {/* MOBILE CARDS VIEW (< md / 768px) */}
        <div className="md:hidden space-y-3">
          {domainStatsDisplay.map((stat) => {
            const drawnCount = projects.filter((p) => p.field === stat.field && p.draw_order).length;
            const isSelected = selectedFieldFilter === stat.field;
            const cfgObj = domainConfigs.find((c) => c.id === stat.id) || {
              id: stat.id,
              field: stat.field,
              groupCount: stat.groupCount,
              evaluatorsPerGroup: stat.evaluatorsPerGroup,
            };

            return (
              <div
                key={stat.id}
                className={`p-3.5 rounded-2xl border transition-all ${
                  isSelected
                    ? 'bg-blue-50/60 border-blue-300 shadow-xs'
                    : 'bg-white border-slate-200 shadow-2xs'
                }`}
              >
                {/* Header: Title & Group Count Direct Input */}
                <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-slate-100">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-bold text-slate-900 truncate">
                      {stat.field}
                    </h3>
                    <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-slate-500 font-mono">
                      <span>專題: <strong className="text-slate-800 font-bold">{stat.count}</strong> 件</span>
                      <span className="text-slate-300">·</span>
                      <span className={drawnCount === stat.count && stat.count > 0 ? 'text-emerald-700 font-semibold' : 'text-slate-600'}>
                        抽籤進度: {drawnCount}/{stat.count}
                      </span>
                    </div>
                  </div>

                  {/* Group Count Direct Controller on Mobile */}
                  <div className="shrink-0 flex flex-col items-end gap-1">
                    <span className="text-[10px] text-slate-400 font-medium">分組組數</span>
                    <div className="inline-flex items-center gap-1 bg-slate-50 px-1 py-0.5 rounded-xl border border-slate-200">
                      <button
                        type="button"
                        onClick={() => handleQuickAdjustGroupCount(stat.id, -1)}
                        disabled={stat.groupCount <= 1}
                        title="減少 1 組"
                        className="w-6 h-6 rounded-lg bg-white hover:bg-slate-200 active:bg-slate-300 disabled:opacity-30 disabled:cursor-not-allowed text-slate-700 font-bold text-xs flex items-center justify-center cursor-pointer shadow-2xs"
                      >
                        -
                      </button>
                      <input
                        type="number"
                        aria-label={`${stat.field}分組組數`}
                        min={1}
                        max={50}
                        value={groupCountInputs[stat.id] !== undefined ? groupCountInputs[stat.id] : stat.groupCount}
                        onChange={(e) => {
                          const val = e.target.value;
                          setGroupCountInputs((prev) => ({ ...prev, [stat.id]: val }));
                          const num = parseInt(val, 10);
                          if (!isNaN(num) && num >= 1 && num <= 50) {
                            handleDirectSetGroupCount(stat.id, num);
                          }
                        }}
                        onBlur={(e) => {
                          const num = parseInt(e.target.value, 10);
                          if (isNaN(num) || num < 1) {
                            handleDirectSetGroupCount(stat.id, 1);
                            setGroupCountInputs((prev) => ({ ...prev, [stat.id]: '1' }));
                          } else if (num > 50) {
                            handleDirectSetGroupCount(stat.id, 50);
                            setGroupCountInputs((prev) => ({ ...prev, [stat.id]: '50' }));
                          } else {
                            setGroupCountInputs((prev) => {
                              const next = { ...prev };
                              delete next[stat.id];
                              return next;
                            });
                          }
                        }}
                        className="w-8 text-center font-mono font-bold text-xs text-blue-700 bg-transparent focus:outline-hidden"
                        title="直接輸入組數"
                      />
                      <button
                        type="button"
                        onClick={() => handleQuickAdjustGroupCount(stat.id, 1)}
                        title="增加 1 組"
                        className="w-6 h-6 rounded-lg bg-white hover:bg-slate-200 active:bg-slate-300 text-slate-700 font-bold text-xs flex items-center justify-center cursor-pointer shadow-2xs"
                      >
                        +
                      </button>
                      <span className="text-[10px] text-slate-400 pr-1">組</span>
                    </div>
                  </div>
                </div>

                {/* Body: Evaluators List */}
                <div className="py-2.5 text-xs border-b border-slate-100">
                  <div className="text-[11px] font-semibold text-slate-500 mb-1 flex items-center justify-between">
                    <span>各組評審名單：</span>
                    <span className="text-[10px] text-slate-400 font-mono">共 {stat.groupCount} 組</span>
                  </div>
                  <div className="space-y-1 bg-slate-50/70 p-2 rounded-xl border border-slate-100">
                    {Array.from({ length: stat.groupCount }, (_, i) => i + 1).map((g) => {
                      const evs = stat.evaluatorsPerGroup?.[g] || [];
                      return (
                        <div key={g} className="flex items-center text-[11px] gap-1.5">
                          <span className="w-4 h-4 rounded-full bg-slate-200 text-slate-700 text-[10px] font-mono font-bold flex items-center justify-center shrink-0">
                            {g}
                          </span>
                          <span className="text-slate-700 truncate">
                            {evs.length > 0 ? (
                              <span className="font-medium text-slate-900">{evs.join('、')}</span>
                            ) : (
                              <span className="text-slate-400 italic">尚未設定評審</span>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Actions Footer */}
                <div className="pt-2.5 flex items-center justify-between gap-1.5">
                  <button
                    onClick={() => handleOpenEvaluatorModal(cfgObj)}
                    className="flex-1 py-1.5 px-2 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold flex items-center justify-center gap-1 border border-blue-200 cursor-pointer transition-colors"
                  >
                    <Users className="w-3.5 h-3.5 shrink-0" />
                    <span>設定評審</span>
                  </button>

                  <button
                    onClick={() => handleOpenEditDomain(cfgObj)}
                    className="py-1.5 px-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium flex items-center justify-center gap-1 border border-slate-200 cursor-pointer transition-colors"
                    title="修改名稱"
                  >
                    <Edit className="w-3.5 h-3.5" />
                    <span>編輯</span>
                  </button>

                  <button
                    onClick={() => { beginDraft(); setDomainToDelete(cfgObj); }}
                    className="p-1.5 rounded-xl hover:bg-rose-50 text-slate-400 hover:text-rose-600 border border-transparent hover:border-rose-200 cursor-pointer transition-colors"
                    title="刪除"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* DESKTOP & TABLET TABLE VIEW (md and above) */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200 text-xs">
                <th className="py-2.5 px-4 border border-slate-200">列標籤 (領域名稱)</th>
                <th className="py-2.5 px-4 text-center border border-slate-200">件數</th>
                <th className="py-2.5 px-4 text-center border border-slate-200">
                  分組組數
                </th>
                <th className="py-2.5 px-4 border border-slate-200">各組評審委員名單</th>
                <th className="py-2.5 px-4 text-center border border-slate-200">抽籤進度</th>
                <th className="py-2.5 px-4 text-right border border-slate-200">管理操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {domainStatsDisplay.map((stat) => {
                const drawnCount = projects.filter((p) => p.field === stat.field && p.draw_order).length;
                const isSelected = selectedFieldFilter === stat.field;
                const cfgObj = domainConfigs.find((c) => c.id === stat.id) || {
                  id: stat.id,
                  field: stat.field,
                  groupCount: stat.groupCount,
                  evaluatorsPerGroup: stat.evaluatorsPerGroup,
                };

                return (
                  <tr
                    key={stat.id}
                    className={`hover:bg-slate-50 transition-colors ${
                      isSelected ? 'bg-blue-50/70 font-semibold' : ''
                    }`}
                  >
                    <td className="py-2 px-4 text-slate-800 border border-slate-200">
                      <span className="font-semibold text-slate-900">{stat.field}</span>
                    </td>
                    <td className="py-2 px-4 text-center font-mono font-bold text-slate-900 border border-slate-200">
                      {stat.count}
                    </td>
                    <td className="py-2 px-4 text-center border border-slate-200">
                      <div className="inline-flex items-center gap-1 bg-white px-1.5 py-1 rounded-xl border border-slate-200 shadow-2xs hover:border-blue-400 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100 transition-all">
                        <button
                          type="button"
                          onClick={() => handleQuickAdjustGroupCount(stat.id, -1)}
                          disabled={stat.groupCount <= 1}
                          title="減少 1 組"
                          className="w-5 h-5 rounded-md bg-slate-100 hover:bg-slate-200 active:bg-slate-300 disabled:opacity-30 disabled:cursor-not-allowed text-slate-700 font-bold text-xs flex items-center justify-center cursor-pointer transition-colors"
                        >
                          -
                        </button>
                        <input
                          type="number"
                          aria-label={`${stat.field}分組組數`}
                          min={1}
                          max={50}
                          value={groupCountInputs[stat.id] !== undefined ? groupCountInputs[stat.id] : stat.groupCount}
                          onChange={(e) => {
                            const val = e.target.value;
                            setGroupCountInputs((prev) => ({ ...prev, [stat.id]: val }));
                            const num = parseInt(val, 10);
                            if (!isNaN(num) && num >= 1 && num <= 50) {
                              handleDirectSetGroupCount(stat.id, num);
                            }
                          }}
                          onBlur={(e) => {
                            const num = parseInt(e.target.value, 10);
                            if (isNaN(num) || num < 1) {
                              handleDirectSetGroupCount(stat.id, 1);
                              setGroupCountInputs((prev) => ({ ...prev, [stat.id]: '1' }));
                            } else if (num > 50) {
                              handleDirectSetGroupCount(stat.id, 50);
                              setGroupCountInputs((prev) => ({ ...prev, [stat.id]: '50' }));
                            } else {
                              setGroupCountInputs((prev) => {
                                const next = { ...prev };
                                delete next[stat.id];
                                return next;
                              });
                            }
                          }}
                          className="w-10 text-center font-mono font-bold text-xs sm:text-sm text-blue-700 bg-transparent focus:outline-hidden [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none cursor-text"
                          title="可直接輸入或點選調整組數"
                        />
                        <button
                          type="button"
                          onClick={() => handleQuickAdjustGroupCount(stat.id, 1)}
                          title="增加 1 組"
                          className="w-5 h-5 rounded-md bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-700 font-bold text-xs flex items-center justify-center cursor-pointer transition-colors"
                        >
                          +
                        </button>
                        <span className="text-[11px] text-slate-400 select-none pr-0.5">組</span>
                      </div>
                    </td>
                    <td className="py-2 px-4 border border-slate-200 max-w-xs">
                      <div className="space-y-1 text-[11px]">
                        {Array.from({ length: stat.groupCount }, (_, i) => i + 1).map((g) => {
                          const evs = stat.evaluatorsPerGroup?.[g] || [];
                          return (
                            <div key={g} className="flex items-center gap-1.5 truncate">
                              <span className="font-bold text-slate-700 font-mono shrink-0">
                                第{g}組:
                              </span>
                              <span className="text-slate-600 truncate">
                                {evs.length > 0 ? evs.join('、') : <span className="text-slate-400 italic">尚未設定（點右側設定）</span>}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </td>
                    <td className="py-2 px-4 text-center border border-slate-200">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-mono font-medium ${
                        drawnCount === stat.count && stat.count > 0
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : drawnCount > 0
                          ? 'bg-amber-50 text-amber-700 border border-amber-200'
                          : 'text-slate-400'
                      }`}>
                        {drawnCount} / {stat.count}
                      </span>
                    </td>
                    <td className="py-2 px-4 text-right border border-slate-200 whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5 justify-end">
                        <button
                          onClick={() => handleOpenEvaluatorModal(cfgObj)}
                          className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-medium flex items-center gap-1 border border-slate-200 cursor-pointer transition-colors"
                          title="設定各組之評審委員名單"
                        >
                          <Users className="w-3.5 h-3.5 text-slate-600" />
                          <span>設定評審</span>
                        </button>

                        <button
                          onClick={() => handleOpenEditDomain(cfgObj)}
                          className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium flex items-center gap-1 cursor-pointer transition-colors"
                          title="修改領域名稱與組數"
                        >
                          <Edit className="w-3 h-3 text-slate-500" />
                          <span>編輯</span>
                        </button>

                        <button
                          onClick={() => { beginDraft(); setDomainToDelete(cfgObj); }}
                          className="p-1 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600 cursor-pointer transition-colors"
                          title="刪除此領域"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {/* Grand Total */}
              <tr className="bg-slate-100/90 font-bold text-slate-900 border-t-2 border-slate-300">
                <td className="py-2.5 px-4 border border-slate-200">總計</td>
                <td className="py-2.5 px-4 text-center font-mono text-rose-700 text-sm border border-slate-200">
                  {totalProjectsCount}
                </td>
                <td className="py-2.5 px-4 text-center font-mono text-slate-900 text-sm border border-slate-200">
                  {totalGroupCount} 組
                </td>
                <td className="py-2.5 px-4 text-xs text-slate-500 border border-slate-200">
                  全校共 {totalGroupCount} 個分組場次
                </td>
                <td className="py-2.5 px-4 text-center font-mono text-emerald-700 text-xs border border-slate-200">
                  {projects.filter((p) => p.draw_order).length} / {totalProjectsCount}
                </td>
                <td className="py-2.5 px-4 text-right text-xs text-slate-500 border border-slate-200">
                  {selectedFieldFilter !== 'ALL' && (
                    <button
                      onClick={() => setSelectedFieldFilter('ALL')}
                      className="text-blue-600 hover:underline cursor-pointer"
                    >
                      顯示全部領域
                    </button>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Excel Schema Badges */}
      <div className="bg-white rounded-3xl border border-slate-200 p-5 text-xs text-slate-600 grid grid-cols-1 md:grid-cols-2 gap-4 shadow-sm">
        <div className="space-y-1.5">
          <div className="font-bold text-slate-800 flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5 text-blue-600" />
            <span>■ 輸入 Excel 欄位：</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {REQUIRED_INPUT_HEADERS.map((h) => (
              <span key={h} className="bg-slate-100 px-2 py-0.5 rounded text-slate-700 font-mono border border-slate-200">
                {h}
              </span>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="font-bold text-slate-800 flex items-center gap-1.5">
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
            <span>■ 輸出 Excel 欄位：</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {REQUIRED_OUTPUT_HEADERS.map((h) => (
              <span key={h} className={`px-2 py-0.5 rounded font-mono ${h.includes('+') ? 'bg-emerald-50 text-emerald-700 font-bold border border-emerald-200' : 'bg-slate-100 text-slate-700 border border-slate-200'}`}>
                {h}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Projects Table / Card View Card */}
      <div className="bg-white rounded-3xl border border-slate-200 p-4 sm:p-6 shadow-sm">
        {/* Section Header: Title & Hand Add Project Action */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 mb-4 border-b border-slate-100">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
              <FolderPlus className="w-5 h-5 text-blue-600 shrink-0" />
              <span>專題名冊管理</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              名冊總計 {projects.length} 件專題 · 支援個別增修、抽籤序號查驗與評審指派
            </p>
          </div>

          <button
            type="button"
            onClick={handleOpenAddProject}
            className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer self-start sm:self-auto"
            title="手動新增一筆專題至名冊"
          >
            <Plus className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>手動新增專題</span>
          </button>
        </div>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            <div className="relative">
              <input
                type="text"
                aria-label="搜尋專題名稱、學號或老師"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜尋專題名稱、學號、老師..."
                className="w-full sm:w-72 bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-4 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            </div>

            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-600">
              <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <select
                aria-label="依領域篩選專題"
                value={selectedFieldFilter}
                onChange={(e) => setSelectedFieldFilter(e.target.value)}
                className="bg-transparent text-slate-800 focus:outline-none cursor-pointer text-xs w-full sm:w-auto"
              >
                <option value="ALL">全部領域 ({projects.length})</option>
                {domainList.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between md:justify-end gap-3">
            <div className="text-xs text-slate-500">
              顯示 {filteredProjects.length} 筆專題 (總計 {projects.length} 筆)
            </div>

            <div className="inline-flex items-center p-0.5 rounded-lg bg-slate-100 border border-slate-200 text-xs">
              <button
                onClick={() => setAdminProjectDisplayMode('table')}
                className={`px-2.5 py-1 rounded-md transition-all cursor-pointer font-medium ${
                  adminProjectDisplayMode === 'table'
                    ? 'bg-white text-emerald-800 shadow-xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                表格檢視
              </button>
              <button
                onClick={() => setAdminProjectDisplayMode('cards')}
                className={`px-2.5 py-1 rounded-md transition-all cursor-pointer font-medium ${
                  adminProjectDisplayMode === 'cards'
                    ? 'bg-white text-emerald-800 shadow-xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                卡片檢視
              </button>
            </div>
          </div>
        </div>

        {adminProjectDisplayMode === 'cards' ? (
          /* Cards Grid View (Responsive on mobile & tablet) */
          <div>
            {filteredProjects.length === 0 ? (
              <div className="py-16 text-center text-slate-400 text-xs sm:text-sm space-y-2">
                <FileSpreadsheet className="w-10 h-10 mx-auto text-slate-300 stroke-1" />
                <p className="font-medium text-slate-600">
                  {projects.length === 0
                    ? '目前尚無專題資料'
                    : '查無符合條件的專題資料'}
                </p>
                <p className="text-xs text-slate-400">
                  {projects.length === 0
                    ? '請點擊上方「匯入 Excel 名冊」或「手動新增專題」開始匯入或建立名冊！'
                    : '請嘗試更換篩選領域或清除搜尋關鍵字'}
                </p>
                {projects.length === 0 && (
                  <div className="pt-3 flex flex-wrap items-center justify-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs flex items-center gap-1.5 cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>匯入 Excel 名冊</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleOpenAddProject}
                      className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-xs flex items-center gap-1.5 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5 text-emerald-400" />
                      <span>手動新增專題</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {filteredProjects.map((p) => {
                  const hasConflict = p.assigned_group && isAdvisorConflict(p.advisor, p.evaluators || []);
                  return (
                    <div
                      key={p.id}
                      className="p-4 rounded-2xl border border-slate-200 bg-slate-50/50 hover:bg-slate-50 hover:border-slate-300 transition-all flex flex-col justify-between"
                    >
                      <div>
                        {/* Top Badges */}
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-mono text-xs text-slate-500 font-semibold bg-white px-2 py-0.5 rounded border border-slate-200">
                              #{p.seq_no}
                            </span>
                            {p.draw_code ? (
                              <span className="font-mono text-xs text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                {p.draw_code}
                              </span>
                            ) : (
                              <span className="text-xs text-slate-400 bg-white px-2 py-0.5 rounded border border-slate-200 italic">
                                未抽籤
                              </span>
                            )}
                            {p.assigned_group && (
                              <span className="font-mono text-xs text-blue-700 font-semibold bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                                第 {p.assigned_group} 組
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => handleStartEdit(p)}
                              className="p-1.5 rounded-lg hover:bg-white text-slate-600 hover:text-slate-900 border border-transparent hover:border-slate-200 transition-colors cursor-pointer"
                              title="編輯專題"
                            >
                              <Edit className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => { beginDraft(); setProjectToDelete({ id: p.id, title: p.project_title }); }}
                              className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                              title="刪除"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Title */}
                        <h4 className="text-sm font-bold text-slate-900 mb-2 leading-snug" title={p.project_title}>
                          {p.project_title}
                        </h4>

                        {/* Details */}
                        <div className="grid grid-cols-2 gap-1.5 text-[11px] text-slate-600 pt-2 border-t border-slate-200/60">
                          <div>
                            <span className="text-slate-400">領域：</span>
                            <span className="font-medium text-slate-800">{p.field}</span>
                          </div>
                          <div>
                            <span className="text-slate-400">班級：</span>
                            <span className="text-slate-700">{p.class_name}</span>
                          </div>
                          <div>
                            <span className="text-slate-400">指導老師：</span>
                            <span className="font-semibold text-slate-800">{p.advisor}</span>
                            {hasConflict && (
                              <span className="ml-1 text-[10px] text-rose-600 font-bold bg-rose-50 px-1 rounded">
                                衝突!
                              </span>
                            )}
                          </div>
                          <div>
                            <span className="text-slate-400">組長學號：</span>
                            <span className="font-mono text-blue-700 font-semibold">{p.leader_id}</span>
                            <span className="ml-1 text-[10px] text-slate-400 font-mono">
                              {p.password_set ? '密碼已設定' : '需設定登入密碼'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Evaluator Footer */}
                      {p.evaluators && p.evaluators.length > 0 && (
                        <div className="mt-3 text-[10px] text-slate-700 bg-white p-2 rounded-xl border border-slate-200 flex items-center justify-between">
                          <span className="truncate">
                            <strong>評審：</strong>
                            {p.evaluators.join('、')}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          /* Table View */
          <div>
            <div className="sm:hidden text-[10px] text-slate-400 flex items-center gap-1 mb-2">
              <Info className="w-3 h-3 text-slate-400" />
              <span>可橫向滑動查看完整 10 項欄位與操作</span>
            </div>
            <div className="overflow-x-auto max-h-[550px] overflow-y-auto -mx-4 px-4 sm:mx-0 sm:px-0">
              <table className="w-full text-left text-xs sm:text-sm min-w-[700px]">
                <thead className="sticky top-0 bg-slate-100/90 text-slate-700 z-10 border-b border-slate-200">
                  <tr className="text-xs font-semibold">
                    <th className="py-2.5 px-3">序號</th>
                    <th className="py-2.5 px-3">+編號(抽籤後)</th>
                    <th className="py-2.5 px-3">分組場次</th>
                    <th className="py-2.5 px-3">評審委員</th>
                    <th className="py-2.5 px-3">領域</th>
                    <th className="py-2.5 px-3">編號</th>
                    <th className="py-2.5 px-3">專題名稱</th>
                    <th className="py-2.5 px-3">組長學號</th>
                    <th className="py-2.5 px-3">指導老師</th>
                    <th className="py-2.5 px-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredProjects.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-12 text-center text-slate-400">
                        <div className="space-y-1">
                          <p className="font-medium text-slate-600 text-sm">
                            {projects.length === 0
                              ? '目前尚無專題資料'
                              : '查無符合條件的專題資料'}
                          </p>
                          <p className="text-xs text-slate-400">
                            {projects.length === 0
                              ? '請點擊上方「匯入 Excel 名冊」或「手動新增專題」開始匯入或建立名冊！'
                              : '請嘗試更換篩選領域或清除搜尋關鍵字'}
                          </p>
                          {projects.length === 0 && (
                            <div className="pt-3 flex flex-wrap items-center justify-center gap-2.5">
                              <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs flex items-center gap-1.5 cursor-pointer"
                              >
                                <Upload className="w-3.5 h-3.5" />
                                <span>匯入 Excel 名冊</span>
                              </button>
                              <button
                                type="button"
                                onClick={handleOpenAddProject}
                                className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-xs flex items-center gap-1.5 cursor-pointer"
                              >
                                <Plus className="w-3.5 h-3.5 text-emerald-400" />
                                <span>手動新增專題</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredProjects.map((p) => {
                      const hasConflict = p.assigned_group && isAdvisorConflict(p.advisor, p.evaluators || []);
                      return (
                        <tr key={p.id} className="hover:bg-slate-50 text-slate-700 transition-colors">
                          <td className="py-2.5 px-3 font-mono text-slate-400">{p.seq_no}</td>
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            {p.draw_code ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-bold border border-emerald-200 text-xs font-mono">
                                {p.draw_code}
                              </span>
                            ) : (
                              <span className="text-slate-400 italic text-xs">未抽籤</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap font-medium text-slate-800">
                            {p.assigned_group ? (
                              <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-mono text-xs border border-blue-200">
                                第 {p.assigned_group} 組
                              </span>
                            ) : (
                              <span className="text-slate-400 italic text-xs">待分配</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap text-xs">
                            {p.evaluators && p.evaluators.length > 0 ? (
                              <span className="text-slate-700 truncate max-w-[140px] block" title={p.evaluators.join('、')}>
                                {p.evaluators.join('、')}
                              </span>
                            ) : (
                              <span className="text-slate-400 italic">-</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-xs border border-slate-200">
                              {p.field}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-xs text-slate-500">{p.original_code}</td>
                          <td className="py-2.5 px-3 font-medium text-slate-900 max-w-xs truncate" title={p.project_title}>
                            {p.project_title}
                          </td>
                          <td className="py-2.5 px-3 font-mono whitespace-nowrap">
                            <span className="font-semibold text-blue-600 block">{p.leader_id}</span>
                            <span className="text-[10px] text-slate-400 font-mono">
                              {p.password_set ? '密碼已設定' : '需設定登入密碼'}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap text-slate-700">
                            <span>{p.advisor}</span>
                            {hasConflict && (
                              <span className="ml-1 text-[10px] text-rose-600 font-bold bg-rose-50 px-1 rounded">
                                衝突!
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => handleStartEdit(p)}
                                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
                                title="編輯資料"
                              >
                                <Edit className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => { beginDraft(); setProjectToDelete({ id: p.id, title: p.project_title }); }}
                                className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                                title="刪除"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Modal for Setting Evaluators / Reviewers with Conflict Avoidance */}
      {isEvaluatorModalOpen && domainForEvaluators && (
        <div role="dialog" aria-modal="true" aria-label="設定各組評審委員名單" className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 sm:p-7 shadow-xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center border border-blue-200">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-slate-900">
                    設定各組評審委員名單
                  </h3>
                  <p className="text-xs text-slate-500">
                    領域：「<strong className="text-slate-800">{domainForEvaluators.field}</strong>」（共 {domainForEvaluators.groupCount} 個分組場次）
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsEvaluatorModalOpen(false)}
                aria-label="關閉評審委員設定"
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-slate-50 border border-slate-200 p-3 rounded-2xl text-xs text-slate-600">
              各組評審委員名單由主辦單位自行設定與維護（匯入名冊時不會自動預設或覆寫）。請直接在下方各組填入評審委員姓名（以頓號、逗號或空白分隔），未指派時亦可留空。
            </div>

            <form onSubmit={handleSaveEvaluators} className="space-y-4">
              <div className="space-y-3.5">
                {Array.from({ length: domainForEvaluators.groupCount }, (_, i) => i + 1).map((g) => {
                  const currentValue = evaluatorDrafts[g] || '';
                  const currentProfs = currentValue
                    .split(/[、,，\s]+/)
                    .map((s) => s.trim())
                    .filter(Boolean);

                  return (
                    <div
                      key={g}
                      className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <label htmlFor={`evaluator-group-${g}`} className="text-xs font-bold text-slate-900 flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center font-mono text-[10px]">
                            {g}
                          </span>
                          <span>第 {g} 組 評審委員名冊</span>
                        </label>
                        <span className="text-[11px] text-slate-500 font-mono">
                          目前 {currentProfs.length} 位委員
                        </span>
                      </div>

                      <input
                        id={`evaluator-group-${g}`}
                        type="text"
                        value={currentValue}
                        onChange={(e) =>
                          setEvaluatorDrafts({
                            ...evaluatorDrafts,
                            [g]: e.target.value,
                          })
                        }
                        placeholder="請輸入教授姓名，以頓號或逗號分隔，例如：陳志成副教授、張麗華副教授"
                        className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2 text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                      />

                      {currentProfs.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {currentProfs.map((prof, idx) => (
                            <span
                              key={idx}
                              className="text-[11px] bg-white text-slate-800 px-2 py-0.5 rounded-md border border-slate-200 font-medium"
                            >
                              {prof}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="pt-2 border-t border-slate-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsEvaluatorModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-sm cursor-pointer flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>儲存評審名單</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal for Adding or Editing a Domain and its Group Count */}
      {isDomainModalOpen && (
        <div role="dialog" aria-modal="true" aria-label={editingDomain ? '編輯領域名稱與組數' : '新增專題展覽領域'} className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-md w-full max-h-[90vh] overflow-y-auto p-6 sm:p-7 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center border border-amber-200">
                  <Settings2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    {editingDomain ? '編輯領域名稱與組數' : '新增專題展覽領域'}
                  </h3>
                  <p className="text-[11px] text-slate-500">自訂展覽領域與評審分組設定</p>
                </div>
              </div>
              <button
                onClick={() => setIsDomainModalOpen(false)}
                aria-label="關閉領域設定"
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {domainFormError && (
              <div role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{domainFormError}</span>
              </div>
            )}

            <form onSubmit={handleSaveDomain} className="space-y-4 text-xs sm:text-sm">
              <div>
                <label htmlFor="domain-name" className="block text-slate-700 mb-1 font-semibold">
                  領域名稱 (Field Name) *
                </label>
                <input
                  id="domain-name"
                  type="text"
                  required
                  value={domainFormName}
                  onChange={(e) => {
                    setDomainFormName(e.target.value);
                    setDomainFormError(null);
                  }}
                  placeholder="例如：智慧車聯網與AIoT"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              <div>
                <label htmlFor="domain-group-count" className="block text-slate-700 mb-1 font-semibold">
                  組數 (評審分組數量) *
                </label>
                <div className="relative">
                  <input
                    id="domain-group-count"
                    type="number"
                    min={1}
                    max={50}
                    required
                    value={domainFormGroupCount}
                    onChange={(e) => {
                      setDomainFormGroupCount(parseInt(e.target.value, 10) || 1);
                      setDomainFormError(null);
                    }}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-slate-900 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                  <span className="absolute right-3.5 top-2.5 text-xs text-slate-400">組</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  用於該領域的分組場次或評審組數（例如圖表中的 2 組、5 組等）
                </p>
              </div>

              {editingDomain && statsMap[editingDomain.field] > 0 && (
                <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-[11px] leading-relaxed">
                  💡 貼心提醒：目前名冊中共有 <strong>{statsMap[editingDomain.field]}</strong> 筆專題屬於「{editingDomain.field}」，若變更領域名稱，系統將自動同步更新所有相關專題的領域標籤！
                </div>
              )}

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsDomainModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-sm cursor-pointer"
                >
                  {editingDomain ? '儲存變更' : '確定新增領域'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal for Deleting Domain Confirmation */}
      {domainToDelete && (
        <div role="dialog" aria-modal="true" aria-label="確認刪除展覽領域" className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-sm w-full p-6 shadow-xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0 border border-rose-100">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">確定刪除此展覽領域？</h3>
                <p className="text-xs text-slate-600 mt-1">
                  領域：「<strong className="text-slate-900">{domainToDelete.field}</strong>」
                </p>
                {statsMap[domainToDelete.field] > 0 && (
                  <p className="text-[11px] text-amber-700 bg-amber-50 p-2 rounded-lg border border-amber-200 mt-2 leading-relaxed">
                    ⚠️ 注意：名冊內尚有 {statsMap[domainToDelete.field]} 筆專題屬於此領域，刪除後將自動歸類至相鄰領域。
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setDomainToDelete(null)}
                className="px-3.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={handleConfirmDeleteDomain}
                className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-sm cursor-pointer"
              >
                確定刪除領域
              </button>
            </div>
          </div>
        </div>
      )}

      {/* In-App Modal for Excel Import Decision */}
      {pendingImportProjects && (
        <div role="dialog" aria-modal="true" aria-label="選擇名冊匯入模式" className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-md w-full p-6 shadow-xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 border border-blue-100">
                <Upload className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  成功解析 {pendingImportProjects.length} 筆專題名冊
                </h3>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  請選擇匯入模式：您可以選擇完全覆蓋現有名單，或是將新名單追加至現有名單之後。
                </p>
                {sharedPasswordEnabled && <p className="text-xs text-indigo-700 mt-2">共用密碼啟用中，匯入檔案內的個別密碼欄位會略過；新專題沿用目前共用密碼。</p>}
                {projects.some(p => p.draw_order) && <label className="mt-3 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                  <input type="checkbox" checked={overwriteAcknowledged} onChange={e => setOverwriteAcknowledged(e.target.checked)} className="mt-0.5 shrink-0" />
                  <span>我了解「完全覆蓋」會以 Excel 內容取代現有名冊，可能清除或改變已完成的抽籤結果。需要保留現有結果時，請使用「追加」。</span>
                </label>}
              </div>
            </div>

            <div className="pt-2 flex flex-col gap-2">
              <button
                onClick={() => handleApplyImport('overwrite')}
                disabled={projects.some(p => p.draw_order) && !overwriteAcknowledged}
                className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-sm transition-all cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span>完全覆蓋並替換現有名單</span>
              </button>

              <button
                onClick={() => handleApplyImport('append')}
                className="w-full py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs border border-slate-200 transition-all cursor-pointer flex items-center justify-center gap-1.5"
              >
                <span>追加至現有名冊 (保留現有資料)</span>
              </button>

              <button
                onClick={() => setPendingImportProjects(null)}
                className="w-full py-2 text-slate-400 hover:text-slate-600 text-xs transition-colors cursor-pointer"
              >
                取消匯入
              </button>
            </div>
          </div>
        </div>
      )}

      {/* In-App Modal for Delete Project Confirmation */}
      {projectToDelete && (
        <div role="dialog" aria-modal="true" aria-label="確認刪除專題" className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-sm w-full p-6 shadow-xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0 border border-rose-100">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">確定刪除此專題？</h3>
                <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                  「{projectToDelete.title}」
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setProjectToDelete(null)}
                className="px-3.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={handleConfirmDelete}
                className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-sm cursor-pointer"
              >
                確認刪除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add or Edit Project Modal */}
      {(isAddModalOpen || editingProject) && (
        <div role="dialog" aria-modal="true" aria-label={editingProject ? '編輯專題組別資料' : '手動新增專題組別'} className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 max-w-xl w-full max-h-[90vh] overflow-y-auto shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base sm:text-lg font-bold text-slate-900">
                {editingProject ? '編輯專題組別資料' : '手動新增專題組別'}
              </h3>
              <button
                onClick={() => {
                  setEditingProject(null);
                  setIsAddModalOpen(false);
                }}
                aria-label="關閉專題編輯"
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formValidationNotice && (
              <div role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{formValidationNotice}</span>
              </div>
            )}

            <form onSubmit={handleSaveModal} className="space-y-4 text-xs sm:text-sm">
              <div>
                <label htmlFor="project-title" className="block text-slate-700 mb-1 font-semibold">專題名稱 *</label>
                <input
                  id="project-title"
                  type="text"
                  required
                  value={formData.project_title || ''}
                  onChange={(e) => setFormData({ ...formData, project_title: e.target.value })}
                  placeholder="例如：基於生成式AI之智慧排程平台"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="project-leader-id" className="block text-slate-700 mb-1 font-semibold">組長學號 *</label>
                  <input
                    id="project-leader-id"
                    type="text"
                    required
                    value={formData.leader_id || ''}
                    onChange={(e) => setFormData({ ...formData, leader_id: e.target.value })}
                    placeholder="例如：110214101"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="project-password" className="block text-slate-700 mb-1 font-semibold flex items-center justify-between">
                    <span>設定／重設組長密碼</span>
                    <span className="text-[10px] text-slate-400 font-normal">{sharedPasswordEnabled ? '共用密碼模式中無法個別設定' : '留空保留現有密碼'}</span>
                  </label>
                  <input
                    id="project-password"
                    type="password"
                    disabled={sharedPasswordEnabled}
                    value={formData.password || ''}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    placeholder="輸入至少 12 字元的新密碼"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={128}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-mono"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="project-field" className="block text-slate-700 mb-1 font-semibold">領域 *</label>
                <select
                  id="project-field"
                  value={formData.field || domainList[0]}
                  onChange={(e) => setFormData({ ...formData, field: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none"
                >
                  {domainList.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="project-original-code" className="block text-slate-700 mb-1 font-semibold">專題編號</label>
                  <input
                    id="project-original-code"
                    type="text"
                    value={formData.original_code || ''}
                    onChange={(e) => setFormData({ ...formData, original_code: e.target.value })}
                    placeholder="例如：AI-01"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="project-advisor" className="block text-slate-700 mb-1 font-semibold">指導老師</label>
                  <input
                    id="project-advisor"
                    type="text"
                    value={formData.advisor || ''}
                    onChange={(e) => setFormData({ ...formData, advisor: e.target.value })}
                    placeholder="例如：王教授"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label htmlFor="project-education-system" className="block text-slate-700 mb-1 font-semibold">學制</label>
                  <input
                    id="project-education-system"
                    type="text"
                    value={formData.education_system || ''}
                    onChange={(e) => setFormData({ ...formData, education_system: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900"
                  />
                </div>
                <div>
                  <label htmlFor="project-department" className="block text-slate-700 mb-1 font-semibold">系所</label>
                  <input
                    id="project-department"
                    type="text"
                    value={formData.department || ''}
                    onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900"
                  />
                </div>
                <div>
                  <label htmlFor="project-class-name" className="block text-slate-700 mb-1 font-semibold">班級</label>
                  <input
                    id="project-class-name"
                    type="text"
                    value={formData.class_name || ''}
                    onChange={(e) => setFormData({ ...formData, class_name: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="project-draw-code" className="block text-slate-700 mb-1 font-semibold">+編號(抽籤後)</label>
                <input
                  id="project-draw-code"
                  type="text"
                  value={formData.draw_code || ''}
                  onChange={(e) => setFormData({ ...formData, draw_code: e.target.value })}
                  placeholder="留空代表未抽籤，或填寫例如：企業智慧-第1組-序號01"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 font-mono"
                />
              </div>

              <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditingProject(null);
                    setIsAddModalOpen(false);
                  }}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-sm cursor-pointer"
                >
                  儲存
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
