import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import type { DomainConfig, ProjectItem } from '../types';
import './DomainScopePicker.css';

interface Props {
  domains: DomainConfig[];
  projects: ProjectItem[];
  selected: string[] | null;
  disabled: boolean;
  onChange: (fields: string[] | null) => void;
}
export function DomainScopePicker({ domains, projects, selected, disabled, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const fields = domains.map(domain => domain.field);
  const checked = selected === null ? fields : selected.filter(field => fields.includes(field));
  const total = projects.filter(project => selected === null || checked.includes(project.field)).length;
  const all = selected === null || (fields.length > 0 && checked.length === fields.length);
  const label = all ? `全校所有領域（${total} 件）` : checked.length === 1 ? `${checked[0]}（${total} 件）` : checked.length ? `已選 ${checked.length} 個領域（${total} 件）` : '請勾選抽籤領域';
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return <div className="domain-scope-picker" ref={ref} onKeyDown={event => {
    if (open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); ref.current?.querySelector('button')?.focus(); }
  }}>
    <button type="button" className="domain-scope-trigger" disabled={disabled} aria-label={`抽籤範圍：${label}`} aria-expanded={open} onClick={() => setOpen(value => !value)}><span>{label}</span><ChevronDown size={16} /></button>
    {open && <div className="domain-scope-options" role="group" aria-label="勾選抽籤領域">
      <div className="domain-scope-heading"><strong>選擇抽籤領域</strong><span>可複選</span><button type="button" aria-label="完成領域選擇" onClick={() => setOpen(false)}><Check size={16} />完成</button></div>
      <div className="domain-scope-shortcuts"><button type="button" onClick={() => onChange(null)}>全選</button><button type="button" onClick={() => onChange([])}>清除</button><span>已選 {checked.length} 個</span></div>
      <div className="domain-scope-list">{domains.map(domain => <label key={domain.id}><input type="checkbox" checked={checked.includes(domain.field)} onChange={event => {
        const next = event.target.checked ? [...checked, domain.field] : checked.filter(field => field !== domain.field);
        onChange(next.length === fields.length ? null : next);
      }} /><span>{domain.field}</span><small>{projects.filter(project => project.field === domain.field).length} 件</small></label>)}</div>
      {!domains.length && <p>尚無領域設定</p>}
      <p className="domain-scope-help">抽籤、重設及輪播皆依勾選範圍執行。</p>
    </div>}
  </div>;
}
