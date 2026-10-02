import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { isPageAssetError, pageFailureMessage } from '../lib/pageRecovery';

interface State { error: unknown; failed: boolean; online: boolean; }
export class PageErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { error: null, failed: false, online: navigator.onLine };
  static getDerivedStateFromError(error: unknown) { return { error, failed: true }; }
  componentDidCatch() {
    // Do not put exception messages (which can contain private data) in the UI or logs.
    console.error('頁面顯示失敗，請重新載入。');
  }
  private connectivity = () => this.setState({ online: navigator.onLine });
  private assetFailure = (event: PromiseRejectionEvent) => {
    if (isPageAssetError(event.reason)) this.setState({ error: event.reason, failed: true });
  };
  componentDidMount() {
    document.getElementById('page-boot-fallback')?.remove();
    window.addEventListener('online', this.connectivity);
    window.addEventListener('offline', this.connectivity);
    window.addEventListener('unhandledrejection', this.assetFailure);
    // Recoverable imports (e.g. Excel tools) handle their own failure. Lazy page
    // failures still reach this render boundary or the unhandled-rejection handler.
    window.dispatchEvent(new Event('page-app-ready'));
  }
  componentWillUnmount() {
    window.removeEventListener('online', this.connectivity);
    window.removeEventListener('offline', this.connectivity);
    window.removeEventListener('unhandledrejection', this.assetFailure);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    const message = pageFailureMessage(this.state.error, this.state.online);
    return <main className="min-h-[100dvh] flex items-center justify-center bg-slate-50 p-5">
      <section role="alert" className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-7 text-center shadow-sm sm:p-10">
        <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-700"><AlertTriangle size={28} /></span>
        <h1 className="text-2xl font-extrabold text-slate-900">{message.title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">{message.description}</p>
        <p className="mt-4 text-xs leading-relaxed text-slate-500">重新載入會清除尚未送出的編輯。若剛執行抽籤、匯入或儲存，請先確認結果再決定是否重試。</p>
        <button type="button" onClick={() => window.location.reload()} className="mt-6 inline-flex items-center justify-center gap-2 rounded-xl bg-blue-800 px-6 py-3 font-bold text-white hover:bg-blue-900"><RefreshCw size={18} />重新載入頁面</button>
      </section>
    </main>;
  }
}
