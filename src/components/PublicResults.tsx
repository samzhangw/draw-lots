import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutGrid, RefreshCw, Search, Table2, X } from 'lucide-react';
import type { PublicDrawResult, PublicResultsResponse } from '../types';
import { useApiRequest } from '../lib/useApiRequest';
import { isApiRequestCancelled } from '../lib/api';
import { formatSessionLabel } from '../lib/sessionLabel';
import { publicResultSearchText, publicResultSearchTerms } from '../lib/publicResultSearch';

export function PublicResults() {
  const request = useApiRequest();
  const [field, setField] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(50);
  const changeSearch = (query: string) => { setSearchQuery(query); setVisibleCount(50); };
  const [displayMode, setDisplayMode] = useState<'cards' | 'table'>(() => {
    try { return localStorage.getItem('public-results-display') === 'table' ? 'table' : 'cards'; }
    catch { return 'cards'; }
  });
  useEffect(() => {
    try { localStorage.setItem('public-results-display', displayMode); } catch {}
  }, [displayMode]);
  const [data, setData] = useState<PublicResultsResponse>({ domains: [], results: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [hasSnapshot, setHasSnapshot] = useState(false);
  const cachedDomains = useRef(new Map<string, PublicResultsResponse>());
  const version = useRef<number | undefined>(undefined);
  const selectedField = useRef('');

  const selectField = (next: string) => {
    changeSearch('');
    selectedField.current = next;
    const cached = cachedDomains.current.get(next);
    setData(previous => cached || { domains: previous.domains, results: [] });
    setHasSnapshot(!!cached);
    setError('');
    setLoading(true);
    setField(next);
  };

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const cached = cachedDomains.current.get(field);
    if (cached) { setData(cached); setHasSnapshot(true); }
    request<PublicResultsResponse>(`/api/public/results${field ? `?field=${encodeURIComponent(field)}` : ''}`, undefined, { signal: controller.signal })
      .then(result => {
        if (selectedField.current !== field) return;
        if (version.current !== undefined && result.version !== version.current) cachedDomains.current.clear();
        version.current = result.version;
        cachedDomains.current.set(field, result);
        setData(result);
        setHasSnapshot(true);
        if (field && !result.domains.includes(field)) selectField('');
      })
      .catch(reason => {
        if (selectedField.current === field && !isApiRequestCancelled(reason)) setError(reason instanceof Error ? reason.message : '抽籤結果暫時無法載入，請稍後再試。');
      })
      .finally(() => { if (!controller.signal.aborted && selectedField.current === field) setLoading(false); });
    return () => controller.abort();
  }, [field, refresh, request]);

  const searchIndex = useMemo(() => data.results.map(result => ({ result, text: publicResultSearchText(result) })), [data.results]);
  const matchingResults = useMemo(() => {
    const terms = publicResultSearchTerms(searchQuery);
    return terms.length ? searchIndex.filter(item => terms.every(term => item.text.includes(term))).map(item => item.result) : data.results;
  }, [data.results, searchIndex, searchQuery]);

  const sessions = useMemo(() => {
    const grouped = new Map<number | null, PublicDrawResult[]>();
    for (const result of matchingResults) {
      const group = grouped.get(result.assigned_group) || [];
      group.push(result);
      grouped.set(result.assigned_group, group);
    }
    let remaining = visibleCount;
    return Array.from(grouped).flatMap(([session, allResults]) => {
      const results = allResults.slice(0, remaining);
      remaining = Math.max(0, remaining - allResults.length);
      return results.length ? [{ session, results, total: allResults.length }] : [];
    });
  }, [matchingResults, visibleCount]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <header className="border-l-4 border-blue-700 pl-4 sm:pl-5">
        <h1 className="text-2xl font-black tracking-tight text-slate-900 sm:text-4xl">各領域抽籤結果</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">選擇領域，查看報告場次與抽籤編號。</p>
      </header>
      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="min-w-0">
          <label htmlFor="public-result-field" className="mb-2 block text-sm font-bold text-slate-700">選擇領域</label>
          <select id="public-result-field" value={field} onChange={event => selectField(event.target.value)} className="min-h-12 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-3 text-base font-semibold text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-600">
            <option value="">請選擇領域</option>
            {data.domains.map(domain => <option key={domain} value={domain}>{domain}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-1 items-end gap-3 min-[360px]:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <span className="mb-2 block text-sm font-bold text-slate-700">顯示方式</span>
        <div role="group" aria-label="結果顯示方式" className="grid min-h-12 grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 lg:min-w-48">
          <button type="button" aria-pressed={displayMode === 'cards'} onClick={() => setDisplayMode('cards')} className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-blue-600 ${displayMode === 'cards' ? 'bg-white text-blue-800 shadow-sm' : 'text-slate-600 hover:bg-white/60'}`}><LayoutGrid className="h-4 w-4" aria-hidden="true" />卡片</button>
          <button type="button" aria-pressed={displayMode === 'table'} onClick={() => setDisplayMode('table')} className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-blue-600 ${displayMode === 'table' ? 'bg-white text-blue-800 shadow-sm' : 'text-slate-600 hover:bg-white/60'}`}><Table2 className="h-4 w-4" aria-hidden="true" />表格</button>
        </div>
        </div>
        <button type="button" disabled={loading} onClick={() => { setLoading(true); setRefresh(value => value + 1); }} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-blue-700 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />{loading ? '更新中…' : '更新結果'}
        </button>
        </div>
        </div>
        <div className="min-w-0 border-t border-slate-100 pt-4">
          <label htmlFor="public-result-search" className="mb-2 block text-sm font-bold text-slate-700">搜尋此領域結果</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input id="public-result-search" type="search" disabled={!field} value={searchQuery} onChange={event => changeSearch(event.target.value)} placeholder="搜尋編號、場次、專題名稱或組長姓名" className="min-h-12 w-full rounded-xl border border-slate-300 bg-slate-50 py-3 pl-10 pr-12 text-base text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-50 [&::-webkit-search-cancel-button]:hidden" />
            {searchQuery && <button type="button" aria-label="清除搜尋" onClick={() => changeSearch('')} className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-200 focus-visible:outline-2 focus-visible:outline-blue-600"><X className="h-4 w-4" aria-hidden="true" /></button>}
          </div>
        </div>
      </div>
      {error && <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-relaxed text-amber-900">{error} {hasSnapshot ? '目前顯示上次取得的結果。' : ''}請按「更新結果」重試。</p>}
      {loading && hasSnapshot && <p role="status" className="text-xs text-slate-500">正在更新，暫時顯示上次取得的結果。</p>}
      {loading && !hasSnapshot ? <div role="status" className="flex items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white py-14 text-sm text-slate-500"><RefreshCw className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />載入抽籤結果中…</div>
        : !field ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-14 text-center"><p className="font-bold text-slate-700">{data.domains.length ? '選擇領域，查看抽籤結果' : '目前尚未設定領域'}</p><p className="mt-2 text-sm text-slate-500">{data.domains.length ? '請使用上方選單選擇要查詢的領域。' : '領域設定完成後，將在此提供查詢。'}</p></div>
        : <section aria-label={`${field}抽籤結果`} className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="min-w-0 break-words text-xl font-black text-slate-900 sm:text-2xl">{field}</h2>
            <span aria-live="polite" className="rounded-full bg-slate-200/60 px-3 py-1.5 text-xs font-semibold text-slate-600">{searchQuery.trim() ? `符合 ${matchingResults.length}／全部 ${data.results.length} 件專題` : `已公布 ${data.results.length} 件專題`}</span>
          </div>
          {!data.results.length ? <p className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-14 text-center text-slate-500">此領域尚無已公布的抽籤結果。</p>
            : !matchingResults.length ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center"><p className="break-words text-sm text-slate-600">找不到符合「{searchQuery.trim()}」的結果。</p><button type="button" onClick={() => changeSearch('')} className="mt-3 min-h-11 rounded-xl bg-blue-50 px-4 py-2 text-sm font-bold text-blue-800 hover:bg-blue-100 focus-visible:outline-2 focus-visible:outline-blue-600">清除搜尋，顯示全部</button></div>
            : sessions.map(({ session, results, total }) => <section key={session ?? 'pending'} aria-label={session ? formatSessionLabel(session) : '場次尚未提供'} className="space-y-3">
              <div className="flex items-center gap-3 px-1">
                <span className="h-5 w-1 rounded-full bg-blue-700" aria-hidden="true" />
                <h3 className="text-base font-black text-blue-900 sm:text-lg">{session ? formatSessionLabel(session) : '場次尚未提供'}</h3>
                <span className="text-xs font-medium text-slate-500">{results.length === total ? `${total} 件專題` : `已顯示 ${results.length}／共 ${total} 件`}</span>
                <span className="h-px flex-1 bg-slate-200" aria-hidden="true" />
              </div>
              {displayMode === 'table' ? <div className="space-y-2">
                <p className="px-1 text-xs text-slate-500 sm:hidden">表格可左右滑動查看完整內容。</p>
                <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm" tabIndex={0} role="region" aria-label={`${session ? formatSessionLabel(session) : '場次尚未提供'}結果表格，可左右捲動`}>
                  <table className="w-full min-w-[560px] text-left text-sm">
                    <caption className="sr-only">{field} · {session ? formatSessionLabel(session) : '場次尚未提供'}抽籤結果</caption>
                    <thead className="bg-blue-50 text-blue-900">
                      <tr>
                        <th scope="col" className="w-28 whitespace-nowrap px-4 py-3 font-bold">抽籤編號</th>
                        <th scope="col" className="w-36 whitespace-nowrap px-4 py-3 font-bold">報告場次</th>
                        <th scope="col" className="px-4 py-3 font-bold">專題名稱</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {results.map((result, index) => <tr key={`${result.draw_code}-${index}`} className="even:bg-slate-50/60 hover:bg-blue-50/50">
                        <td className="px-4 py-4 font-mono text-lg font-black text-blue-900 [overflow-wrap:anywhere]">{result.draw_code}</td>
                        <td className="px-4 py-4 font-bold text-slate-700">{result.assigned_group ? formatSessionLabel(result.assigned_group) : '場次尚未提供'}</td>
                        <td className="px-4 py-4 [overflow-wrap:anywhere]">
                          <p className="font-semibold leading-relaxed text-slate-900">{result.project_title}</p>
                          <p className="mt-1.5 text-xs leading-relaxed text-slate-500">組長姓名：<span className="font-semibold text-slate-700">{result.leader_name || '尚未提供'}</span></p>
                        </td>
                      </tr>)}
                    </tbody>
                  </table>
                </div>
              </div> : <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:gap-4">
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
              </div>}
            </section>)}
          {matchingResults.length > 0 && <div className="space-y-3 pt-2 text-center">
            <p aria-live="polite" className="text-xs font-medium text-slate-500">目前顯示 {Math.min(visibleCount, matchingResults.length)}／共 {matchingResults.length} 件{searchQuery.trim() ? '符合搜尋的專題' : '專題'}</p>
            {visibleCount < matchingResults.length && <button type="button" onClick={() => setVisibleCount(count => Math.min(count + 50, matchingResults.length))} className="min-h-12 rounded-xl border border-blue-200 bg-white px-6 py-3 text-sm font-bold text-blue-800 shadow-sm hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">載入更多（還有 {matchingResults.length - visibleCount} 件）</button>}
          </div>}
        </section>}
    </div>
  );
}
