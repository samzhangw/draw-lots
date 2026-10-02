import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, X } from 'lucide-react';
import type { DomainConfig, ProjectItem } from '../types';
import { buildResultSlides } from '../lib/resultPresentation';
import { useModalFocus } from '../lib/useModalFocus';
import './ResultCarousel.css';

interface Props {
  projects: ProjectItem[];
  domains: DomainConfig[];
  scope: string;
  onClose: () => void;
}

export function ResultCarousel({ projects, domains, scope, onClose }: Props) {
  const [pageSize, setPageSize] = useState(4);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [seconds, setSeconds] = useState(10);
  const [remaining, setRemaining] = useState(10);
  const [visible, setVisible] = useState(!document.hidden);
  const listRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<string | null>(null);
  const slides = useMemo(() => buildResultSlides(projects, domains, scope, pageSize), [projects, domains, scope, pageSize]);
  const safeIndex = Math.min(index, Math.max(0, slides.length - 1));
  const slide = slides[safeIndex];
  const next = slides[(safeIndex + 1) % slides.length];
  const running = playing && visible && slides.length > 1;

  useModalFocus('result-carousel', onClose);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const observer = new ResizeObserver(([entry]) => {
      // Reserve enough vertical room for long Chinese titles on small projectors/phones.
      const width = entry.contentRect.width;
      const fontSize = Math.max(18, Math.min(30, window.innerWidth * 0.02));
      const longest = Math.max(1, ...projects.map((item) => item.project_title.length));
      const titleLines = Math.ceil(longest * fontSize / Math.max(80, width - 150));
      const rowHeight = Math.max(width < 700 ? 112 : 100, titleLines * fontSize * 1.3 + 48);
      setPageSize(Math.max(1, Math.min(8, Math.floor((entry.contentRect.height + 10) / (rowHeight + 10)))));
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [projects]);
  useEffect(() => {
    // Keep the currently shown project visible when the viewport changes pagination.
    const anchor = anchorRef.current;
    if (anchor) {
      const found = slides.findIndex((page) => page.items.some((item) => item.id === anchor));
      if (found >= 0) setIndex(found);
    }
    setRemaining(seconds);
  }, [slides, seconds]);
  useEffect(() => { anchorRef.current = slide?.items[0]?.id ?? null; }, [slide]);
  useEffect(() => { setRemaining(seconds); listRef.current?.scrollTo({ top: 0 }); }, [slide?.key, seconds]);
  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => {
      if (remaining > 1) setRemaining(remaining - 1);
      else {
        setIndex((current) => (current + 1) % slides.length);
        setRemaining(seconds);
      }
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [running, remaining, seconds, slides.length]);

  const move = (direction: number) => {
    setIndex((safeIndex + direction + slides.length) % slides.length);
    setRemaining(seconds);
  };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('select, input, textarea')) return;
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault(); move(event.key === 'ArrowRight' ? 1 : -1);
      } else if (event.code === 'Space') {
        event.preventDefault(); setPlaying((value) => !value);
      }
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  });

  const groups = slides.map((page, position) => ({ page, position })).filter(({ page }) => page.page === 0);
  return (
    <section className="result-carousel" role="dialog" aria-modal="true" aria-label="抽籤結果輪播">
      <header className="result-carousel-header">
        <div className="result-carousel-heading">
          <p>國立臺中科技大學 · 專題報告抽籤結果</p>
          <h2>{slide?.field ?? '目前沒有可展示的抽籤結果'}</h2>
        </div>
        <button onClick={onClose} className="result-control" aria-label="結束輪播，返回抽籤畫面"><X size={20} /><span>返回抽籤</span></button>
      </header>
      {slide && <div className="result-carousel-meta">
        <strong>第 <b>{slide.group}</b> 組</strong>
        <span>共 {slide.groupTotal} 件 · 本組第 {slide.page + 1}／{slide.pages} 頁</span>
        <span className="result-carousel-range">報告順位 {slide.items[0].draw_order}–{slide.items.at(-1)!.draw_order}</span>
      </div>}
      <div className="result-carousel-list" ref={listRef} onWheel={() => setPlaying(false)} onTouchMove={() => setPlaying(false)} style={{ '--result-rows': pageSize } as React.CSSProperties}>
        {slide?.items.map((item) => <article className="result-carousel-row" key={item.id}>
          <div className="result-carousel-order"><small>報告順位</small><strong>{String(item.draw_order).padStart(2, '0')}</strong></div>
          <div className="result-carousel-project"><span>{item.draw_code || '編號未設定'}</span><h3>{item.project_title}</h3></div>
        </article>)}
        {!slide && <p className="result-carousel-empty">請先完成抽籤，再開始展示。</p>}
      </div>
      <footer className="result-carousel-footer">
        <div className="result-carousel-controls">
          <div className="result-carousel-transport">
            <button className="result-control" onClick={() => move(-1)} disabled={slides.length < 2} aria-label="上一頁"><ChevronLeft /></button>
            <button className="result-control result-control-primary" onClick={() => setPlaying((value) => !value)} disabled={slides.length < 2} aria-label={playing ? '暫停輪播' : '播放輪播'}>{playing ? <Pause size={18} /> : <Play size={18} />}{playing ? '暫停' : '播放'}</button>
            <button className="result-control" onClick={() => move(1)} disabled={slides.length < 2} aria-label="下一頁"><ChevronRight /></button>
            <span className="result-carousel-counter">{slides.length ? safeIndex + 1 : 0}／{slides.length} 頁</span>
          </div>
          <label>跳至場次<select aria-label="跳至場次" value={slide ? JSON.stringify([slide.field, slide.group]) : ''} onChange={(event) => {
            const found = groups.find(({ page }) => JSON.stringify([page.field, page.group]) === event.target.value);
            if (found) { setIndex(found.position); setRemaining(seconds); }
          }}>{groups.map(({ page }) => <option key={page.key} value={JSON.stringify([page.field, page.group])}>{page.field} · 第 {page.group} 組</option>)}</select></label>
          <label>換頁間隔<select aria-label="換頁間隔" value={seconds} onChange={(event) => setSeconds(Number(event.target.value))}>{[5, 10, 15, 20, 30].map((value) => <option key={value} value={value}>{value} 秒</option>)}</select></label>
        </div>
        <div className="result-carousel-hint"><span>{slides.length < 2 ? '單頁結果' : !visible ? '背景暫停' : playing ? `${remaining} 秒後換頁 · 循環播放` : '已暫停'}{next && slides.length > 1 ? ` · 下一頁：${next.field} 第 ${next.group} 組` : ''}</span><span>← → 換頁 · 空白鍵播放／暫停 · Esc 返回</span></div>
      </footer>
    </section>
  );
}
