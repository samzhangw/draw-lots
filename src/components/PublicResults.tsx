import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { PublicResultsResponse } from '../types';
import { useApiRequest } from '../lib/useApiRequest';
import { isApiRequestCancelled } from '../lib/api';
import { formatSessionLabel } from '../lib/sessionLabel';

export function PublicResults() {
  const request = useApiRequest();
  const [field, setField] = useState('');
  const [data, setData] = useState<PublicResultsResponse>({ domains: [], results: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setData(previous => ({ ...previous, results: [] }));
    request<PublicResultsResponse>(`/api/public/results${field ? `?field=${encodeURIComponent(field)}` : ''}`, undefined, { signal: controller.signal })
      .then(result => {
        setData(result);
        if (field && !result.domains.includes(field)) setField('');
      })
      .catch(reason => {
        if (!isApiRequestCancelled(reason)) setError(reason instanceof Error ? reason.message : '抽籤結果暫時無法載入，請稍後再試。');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [field, refresh, request]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <header>
        <h1 className="text-2xl font-black tracking-tight text-slate-900 sm:text-4xl">各領域抽籤結果</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">選擇領域即可查看已公布的抽籤結果，無須登入。</p>
      </header>
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="min-w-0 flex-1 basis-60">
          <label htmlFor="public-result-field" className="mb-2 block text-sm font-bold text-slate-700">選擇領域</label>
          <select id="public-result-field" value={field} onChange={event => { setLoading(true); setField(event.target.value); }} className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-600">
            <option value="">請選擇領域</option>
            {data.domains.map(domain => <option key={domain} value={domain}>{domain}</option>)}
          </select>
        </div>
        <button type="button" disabled={loading} onClick={() => setRefresh(value => value + 1)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-50 px-4 py-2.5 text-sm font-bold text-blue-800 hover:bg-blue-100 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />更新結果
        </button>
      </div>
      {error ? <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{error} 請按「更新結果」重試。</p>
        : loading ? <p role="status" className="py-10 text-center text-slate-500">載入抽籤結果中…</p>
        : !field ? <p className="py-10 text-center text-slate-500">{data.domains.length ? '請先選擇要查詢的領域。' : '目前尚未設定領域。'}</p>
        : <section aria-label={`${field}抽籤結果`} className="space-y-3">
          <h2 className="break-words text-xl font-bold text-slate-900">{field}</h2>
          {!data.results.length ? <p className="rounded-2xl bg-white p-8 text-center text-slate-500">此領域尚無已公布的抽籤結果。</p>
            : data.results.map((result, index) => <article key={`${result.draw_code}-${index}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-[7rem_9rem_minmax(0,1fr)_7rem] sm:gap-6">
                <div className="min-w-0"><dt className="text-xs font-medium text-slate-500">抽籤編號</dt><dd className="mt-1 break-words text-xl font-black text-blue-800">{result.draw_code}</dd></div>
                <div className="min-w-0"><dt className="text-xs font-medium text-slate-500">報告場次</dt><dd className="mt-1 text-base font-bold text-slate-800">{result.assigned_group ? formatSessionLabel(result.assigned_group) : '場次尚未提供'}</dd></div>
                <div className="col-span-2 min-w-0 sm:col-span-1"><dt className="text-xs font-medium text-slate-500">專題名稱</dt><dd className="mt-1 break-words text-base font-bold leading-relaxed text-slate-900">{result.project_title}</dd></div>
                <div className="col-span-2 min-w-0 sm:col-span-1"><dt className="text-xs font-medium text-slate-500">組長姓名</dt><dd className="mt-1 break-words text-base font-semibold text-slate-700">{result.leader_name || '尚未提供'}</dd></div>
              </dl>
            </article>)}
        </section>}
    </div>
  );
}
