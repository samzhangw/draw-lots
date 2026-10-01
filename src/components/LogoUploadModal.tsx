import React, { useState, useRef } from 'react';
import { Image as ImageIcon, Upload, Link, X, RotateCcw, Check, Sparkles, AlertCircle } from 'lucide-react';
import { useModalFocus } from '../lib/useModalFocus';

interface LogoUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentLogoUrl: string | null;
  onSaveLogo: (logoUrl: string | null) => Promise<void>;
}

export const LogoUploadModal: React.FC<LogoUploadModalProps> = ({
  isOpen,
  onClose,
  currentLogoUrl,
  onSaveLogo,
}) => {
  const [selectedTab, setSelectedTab] = useState<'upload' | 'url'>('upload');
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentLogoUrl);
  const [urlInput, setUrlInput] = useState<string>(currentLogoUrl && currentLogoUrl.startsWith('http') ? currentLogoUrl : '');
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useModalFocus(isOpen ? 'logo' : null, onClose);

  if (!isOpen) return null;

  const handleFileChange = (file: File | null) => {
    if (!file) return;
    setErrorMessage(null);

    // Validate type
    if (!file.type.startsWith('image/')) {
      setErrorMessage('請選擇有效的圖片檔案（PNG, JPG, SVG, WebP）。');
      return;
    }

    // Validate size (max 8MB)
    if (file.size > 8 * 1024 * 1024) {
      setErrorMessage('圖片大小超過 8MB，請選擇較小的圖片或壓縮後再上傳。');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      if (result) {
        setPreviewUrl(result);
      }
    };
    reader.onerror = () => {
      setErrorMessage('讀取圖片失敗，請重試或選擇其他圖片。');
    };
    reader.readAsDataURL(file);
  };

  const handleUrlChange = (val: string) => {
    setUrlInput(val);
    setErrorMessage(null);
    if (val.trim()) {
      setPreviewUrl(val.trim());
    } else {
      setPreviewUrl(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      await onSaveLogo(previewUrl);
      setIsSaving(false);
      onClose();
    } catch {
      setIsSaving(false);
      setErrorMessage('儲存圖標時發生錯誤，請稍後重試。');
    }
  };

  const handleResetToDefault = async () => {
    try {
      setIsSaving(true);
      await onSaveLogo(null);
      setPreviewUrl(null);
      setUrlInput('');
      setIsSaving(false);
      onClose();
    } catch {
      setIsSaving(false);
      setErrorMessage('恢復預設圖標失敗，請稍後重試。');
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="更換頁首圖標" className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-3xl max-w-lg w-full max-h-[92vh] overflow-y-auto p-5 sm:p-7 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center border border-rose-200 shrink-0">
              <ImageIcon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-slate-900">
                更換頁首圖標 (Logo)
              </h3>
              <p className="text-xs text-slate-500">
                可上傳本機圖片或指定圖檔網址，即時套用至全站頁首
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="關閉圖標設定"
            className="text-slate-400 hover:text-slate-700 p-1.5 rounded-xl hover:bg-slate-100 cursor-pointer transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Live Preview Box */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-700 flex items-center justify-between">
            <span>頁首即時效果預覽</span>
            {previewUrl && (
              <span className="text-[11px] text-emerald-600 font-medium flex items-center gap-1">
                <Check className="w-3.5 h-3.5" /> 自訂圖標已就緒
              </span>
            )}
          </label>
          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 flex items-center gap-3">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt="自訂圖標預覽"
                className="w-11 h-11 rounded-xl object-contain bg-white shadow-2xs border border-slate-200/90 p-0.5 shrink-0"
                onError={() => {
                  setErrorMessage('圖片網址無法載入，請確認網址有效性或使用本機上傳。');
                }}
              />
            ) : (
              <div className="w-11 h-11 rounded-xl bg-gradient-to-b from-rose-800 to-rose-950 text-white flex flex-col items-center justify-center shadow-xs border border-rose-900/40 shrink-0">
                <span className="text-xs font-serif font-black tracking-widest leading-none text-rose-100">
                  中科
                </span>
                <span className="text-[9px] font-mono tracking-tighter text-rose-300 font-bold leading-none mt-0.5">
                  NTCUST
                </span>
              </div>
            )}
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-500 uppercase truncate">
                國立臺中科技大學 / 資訊與流通學院
              </div>
              <div className="text-sm font-black text-slate-900 truncate mt-0.5">
                專題成果展 <span className="text-rose-700 font-semibold text-xs">報告抽籤序位系統</span>
              </div>
            </div>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-xl">
          <button
            type="button"
            onClick={() => setSelectedTab('upload')}
            className={`py-2 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
              selectedTab === 'upload'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>上傳本機圖檔</span>
          </button>
          <button
            type="button"
            onClick={() => setSelectedTab('url')}
            className={`py-2 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
              selectedTab === 'url'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Link className="w-3.5 h-3.5" />
            <span>輸入圖片網址</span>
          </button>
        </div>

        {/* Tab Content: Upload File */}
        {selectedTab === 'upload' && (
          <div className="space-y-3">
            <input
              type="file"
              aria-label="選擇圖標圖片"
              ref={fileInputRef}
              accept="image/png, image/jpeg, image/webp, image/svg+xml"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  handleFileChange(e.target.files[0]);
                }
              }}
              className="hidden"
            />
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all ${
                isDragOver
                  ? 'border-blue-500 bg-blue-50/50'
                  : 'border-slate-300 hover:border-slate-400 bg-slate-50/50 hover:bg-slate-50'
              }`}
            >
              <div className="w-12 h-12 rounded-2xl bg-white border border-slate-200 text-slate-600 flex items-center justify-center mx-auto mb-2.5 shadow-2xs">
                <Upload className="w-6 h-6 text-slate-500" />
              </div>
              <div className="text-xs font-bold text-slate-800">
                點擊選擇圖片，或將圖檔拖曳至此
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                支援 PNG、SVG、JPG、WebP 格式（建議尺寸 128x128 像素或正方形圖標）
              </p>
            </div>
          </div>
        )}

        {/* Tab Content: Image URL */}
        {selectedTab === 'url' && (
          <div className="space-y-2">
            <label htmlFor="logo-image-url" className="text-xs font-semibold text-slate-700">
              圖片網址 (URL)
            </label>
            <input
              id="logo-image-url"
              type="url"
              placeholder="https://example.com/logo.png"
              value={urlInput}
              onChange={(e) => handleUrlChange(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs sm:text-sm text-slate-800 placeholder-slate-400 focus:outline-hidden focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
            <p className="text-[11px] text-slate-400">
              可填入公開存取的直接圖檔連結（支援 https:// 開頭之網址）
            </p>
          </div>
        )}

        {/* Error Notice */}
        {errorMessage && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Actions Footer */}
        <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
          {currentLogoUrl ? (
            <button
              type="button"
              onClick={handleResetToDefault}
              disabled={isSaving}
              className="px-3 py-2 rounded-xl text-xs font-medium text-slate-600 hover:text-rose-700 hover:bg-rose-50 border border-slate-200 cursor-pointer transition-colors flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>恢復預設校徽</span>
            </button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 border border-slate-200 cursor-pointer transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving || previewUrl === currentLogoUrl}
              className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors flex items-center gap-1.5 shadow-xs"
            >
              {isSaving ? (
                <span>儲存中...</span>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>套用此圖標</span>
                </>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
