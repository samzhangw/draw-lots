import type { PublicDrawResult } from '../types';
import { formatSessionLabel } from './sessionLabel';

const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase('zh-TW').replace(/\s+/g, '');

export function publicResultSearchText(result: PublicDrawResult): string {
  const session = result.assigned_group;
  return normalize([result.draw_code, result.project_title, result.leader_name || '尚未提供',
    session ? `${formatSessionLabel(session)} 第${session}場次` : '場次尚未提供'].join(' '));
}

export function publicResultSearchTerms(query: string): string[] {
  return query.normalize('NFKC').trim().split(/\s+/).map(normalize).filter(Boolean);
}
