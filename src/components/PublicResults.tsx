import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { PublicDrawResult, PublicResultsResponse } from '../types';
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

  const sessions = useMemo(() => {
    const grouped = new Map<number | null, PublicDrawResult[]>();
    for (const result of data.results) {
      const group = grouped.get(result.assigned_group) || [];
      group.push(result);
      grouped.set(result.assigned_group, group);
    }
    return Array.from(grouped, ([session, results]) => ({ session, results }));
  }, [data.results]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <header className="border-l-4 border-blue-700 pl-4 sm:pl-5">
        <h1 className="text-2xl font-black tracking-tight text-slate-900 sm:text-4xl">各領域抽籤結果</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">選擇領域，查看報告場次與抽籤編號。</p>
      </header>
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="min-w-0 flex-1 basis-60">
          <label htmlFor="public-result-field" className="mb-2 block text-sm font-bold text-slate-700">選擇領域</label>
          <select id="public-result-field" value={field} onChange={event => { setLoading(true); setField(event.target.value); }} className="min-h-12 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-3 text-base font-semibold text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-600">
            <option value="">請選擇領域</option>
            {data.domains.map(domain => <option key={domain} value={domain}>{domain}</option>)}
          </select>
        </div>
        <button type="button" disabled={loading} onClick={() => setRefresh(value => value + 1)} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-blue-700 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />更新結果
        </button>
      </div>
      {error ? <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-relaxed text-amber-900">{error} 請按「更新結果」重試。</p>
        : loading ? <div role="status" className="flex items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white py-14 text-sm text-slate-500"><RefreshCw className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />載入抽籤結果中…</div>
        : !field ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-14 text-center"><p className="font-bold text-slate-700">{data.domains.length ? '選擇領域，查看抽籤結果' : '目前尚未設定領域'}</p><p className="mt-2 text-sm text-slate-500">{data.domains.length ? '請使用上方選單選擇要查詢的領域。' : '領域設定完成後，將在此提供查詢。'}</p></div>
        : <section aria-label={`${field}抽籤結果`} className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="min-w-0 break-words text-xl font-black text-slate-900 sm:text-2xl">{field}</h2>
            <span className="rounded-full bg-slate-200/60 px-3 py-1.5 text-xs font-semibold text-slate-600">已公布 {data.results.length} 件專題</span>
          </div>
          {!data.results.length ? <p className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-14 text-center text-slate-500">此領域尚無已公布的抽籤結果。</p>
            : sessions.map(({ session, results }) => <section key={session ?? 'pending'} aria-label={session ? formatSessionLabel(session) : '場次尚未提供'} className="space-y-3">
              <div className="flex items-center gap-3 px-1">
                <span className="h-5 w-1 rounded-full bg-blue-700" aria-hidden="true" />
                <h3 className="text-base font-black text-blue-900 sm:text-lg">{session ? formatSessionLabel(session) : '場次尚未提供'}</h3>
                <span className="text-xs font-medium text-slate-500">{results.length} 件專題</span>
                <span className="h-px flex-1 bg-slate-200" aria-hidden="true" />
              </div>
              <div className="space-y-3">
                {results.map((result, index) => <article key={`${result.draw_code}-${index}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                  <dl className="grid grid-cols-2 items-start gap-x-4 gap-y-4 lg:gap-x-6">
                    <div className="col-span-2 min-w-0">
                      <dt className="text-xs font-medium text-slate-500">專題名稱</dt>
                      <dd className="mt-1.5 break-words text-xl font-black leading-relaxed text-slate-900 sm:text-2xl">{result.project_title}</dd>
                    </div>
                    <div className="col-span-2 -mt-2 flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                      <dt className="shrink-0 text-sm font-medium text-slate-500">組長姓名</dt>
                      <dd className="min-w-0 break-words text-base font-bold text-slate-700">{result.leader_name || '尚未提供'}</dd>
                    </div>
                    <div className="h-full min-w-0 rounded-xl bg-blue-50 px-3 py-3 lg:text-center">
                      <dt className="text-xs font-bold text-blue-700">抽籤編號</dt>
                      <dd className="mt-1 break-words font-mono text-3xl font-black tracking-tight text-blue-900 sm:text-4xl">{result.draw_code}</dd>
                    </div>
                    <div className="h-full min-w-0 rounded-xl bg-blue-50 px-3 py-3 lg:text-center">
                      <dt className="text-xs font-bold text-blue-700">報告場次</dt>
                      <dd className="mt-1 break-words text-2xl font-black leading-relaxed text-blue-900 sm:text-3xl">{result.assigned_group ? formatSessionLabel(result.assigned_group) : '場次尚未提供'}</dd>
                    </div>
                  </dl>
                </article>)}
              </div>
            </section>)}
        </section>}
    </div>
  );
}
