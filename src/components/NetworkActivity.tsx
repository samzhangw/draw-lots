import { useEffect, useState, useSyncExternalStore } from 'react';
import { LoaderCircle } from 'lucide-react';
import { getActiveRequestCount, subscribeToRequests } from '../lib/api';

export function NetworkActivity() {
  const activeRequests = useSyncExternalStore(subscribeToRequests, getActiveRequestCount, () => 0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (activeRequests === 0) {
      setVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setVisible(true), 200);
    return () => window.clearTimeout(timer);
  }, [activeRequests > 0]);

  if (!visible || activeRequests === 0) return null;

  return (
    <div role="status" aria-live="polite" className="fixed bottom-4 right-4 z-[90] flex items-center gap-3 rounded-2xl border border-blue-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-xl sm:bottom-6 sm:right-6">
      <LoaderCircle className="h-5 w-5 shrink-0 animate-spin text-blue-700 motion-reduce:animate-none" aria-hidden="true" />
      <span>正在等待後端回應…</span>
    </div>
  );
}
