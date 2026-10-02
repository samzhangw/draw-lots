import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { DomainConfig } from '../types';

interface Drag {
  id: string;
  pointerId: number;
  version: number | null;
  order: DomainConfig[];
  x: number;
  y: number;
  startX: number;
  startY: number;
  moved: boolean;
}

export function useDomainDragSort(configs: DomainConfig[], version: number | null, disabled: boolean,
  save: (order: DomainConfig[]) => Promise<void>) {
  const drag = useRef<Drag | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [previewIds, setPreviewIds] = useState<string[] | null>(null);
  const cancel = () => { drag.current = null; setDraggedId(null); setPreviewIds(null); };

  // A refresh or another operation invalidates the captured roster/version.
  useEffect(() => {
    if (drag.current && (disabled || drag.current.version !== version)) cancel();
  }, [disabled, version]);

  const moveOverRow = (active: Drag) => {
    if (!active.moved) return;
    const targetId = document.elementFromPoint(active.x, active.y)
      ?.closest('[data-domain-order-id]')?.getAttribute('data-domain-order-id');
    const from = active.order.findIndex(cfg => cfg.id === active.id);
    const to = active.order.findIndex(cfg => cfg.id === targetId);
    if (from < 0 || to < 0 || from === to) return;
    const order = [...active.order];
    const [item] = order.splice(from, 1);
    order.splice(to, 0, item);
    active.order = order;
    setPreviewIds(order.map(cfg => cfg.id));
  };

  // Continue scrolling while a mouse/touch pointer is held near the viewport edge.
  useEffect(() => {
    if (!draggedId) return;
    let frame = 0;
    const tick = () => {
      const active = drag.current;
      if (!active) return;
      if (active.moved) {
        const margin = 72;
        const distance = active.y < margin ? active.y - margin
          : active.y > window.innerHeight - margin ? active.y - (window.innerHeight - margin) : 0;
        if (distance) {
          window.scrollBy(0, Math.max(-16, Math.min(16, distance / 4)));
          moveOverRow(active);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [draggedId]);

  const persist = async (order: DomainConfig[]) => {
    setPreviewIds(order.map(cfg => cfg.id));
    try { await save(order); }
    finally { setPreviewIds(null); }
  };

  const start = (event: PointerEvent<HTMLButtonElement>, id: string) => {
    if (disabled || !event.isPrimary || event.button !== 0 || drag.current) return;
    event.preventDefault();
    event.currentTarget.focus();
    // Capture on the stable container: moving a row can detach its handle and lose capture.
    event.currentTarget.closest<HTMLElement>('[data-domain-order-container]')?.setPointerCapture(event.pointerId);
    drag.current = {
      id, pointerId: event.pointerId, version, order: [...configs],
      x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false,
    };
    setDraggedId(id);
  };

  const move = (event: PointerEvent<HTMLElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    active.x = event.clientX;
    active.y = event.clientY;
    active.moved ||= Math.hypot(active.x - active.startX, active.y - active.startY) >= 5;
    moveOverRow(active);
  };

  const finish = (event: PointerEvent<HTMLElement>, commit: boolean) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    cancel();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (commit && !disabled && active.version === version
      && active.order.some((cfg, index) => cfg.id !== configs[index]?.id)) void persist(active.order);
  };

  const keyDown = (event: KeyboardEvent<HTMLButtonElement>, id: string) => {
    if (event.key === 'Escape') { event.preventDefault(); cancel(); return; }
    if (disabled || drag.current || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const from = configs.findIndex(cfg => cfg.id === id);
    const to = from + (event.key === 'ArrowUp' ? -1 : 1);
    if (from < 0 || to < 0 || to >= configs.length) return;
    const order = [...configs];
    [order[from], order[to]] = [order[to], order[from]];
    void persist(order);
  };

  const byId = new Map(configs.map(cfg => [cfg.id, cfg]));
  const ordered = previewIds?.length === configs.length && previewIds.every(id => byId.has(id))
    ? previewIds.map(id => byId.get(id)!) : configs;
  return { ordered, draggedId, start, move, finish, keyDown };
}
