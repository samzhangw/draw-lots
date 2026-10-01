import { useEffect, useRef } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

interface FloatingNoticeProps {
  message: string;
  type?: 'success' | 'error' | 'info';
  onClose: () => void;
  actionLabel?: string;
  onAction?: () => void;
  autoDismissMs?: number;
}

export function FloatingNotice({
  message,
  type = 'info',
  onClose,
  actionLabel,
  onAction,
  autoDismissMs = 5000,
}: FloatingNoticeProps) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (autoDismissMs <= 0) return;
    const timer = window.setTimeout(() => onCloseRef.current(), autoDismissMs);
    return () => window.clearTimeout(timer);
  }, [message, autoDismissMs]);

  const Icon = type === 'success' ? CheckCircle2 : type === 'error' ? AlertCircle : Info;
  const title = type === 'success' ? '操作成功' : type === 'error' ? '請注意' : '網站提醒';
  const color = type === 'success'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
    : type === 'error'
      ? 'border-rose-200 bg-rose-50 text-rose-900'
      : 'border-blue-200 bg-blue-50 text-blue-950';

  return (
    <div
      role={type === 'error' ? 'alert' : 'status'}
      className={`fixed inset-x-4 top-4 z-[100] mx-auto max-h-[60vh] max-w-md overflow-y-auto rounded-2xl border p-4 shadow-xl sm:inset-x-auto sm:right-6 sm:top-6 sm:mx-0 sm:w-96 ${color}`}
    >
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">{title}</p>
          <p className="mt-1 whitespace-pre-line break-words text-sm leading-6">{message}</p>
          {actionLabel && onAction && (
            <button type="button" onClick={onAction} className="mt-3 rounded-lg border border-current px-3 py-1.5 text-sm font-bold hover:bg-white/70">
              {actionLabel}
            </button>
          )}
        </div>
        <button type="button" onClick={onClose} aria-label="關閉提醒" className="rounded-lg p-1 hover:bg-white/70">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
