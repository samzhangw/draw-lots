import type { ProjectItem } from '../types';

/** A partial result also blocks drawing the domain again until it is reset. */
export function getAvailableDrawFields(fields: string[], projects: ProjectItem[]): string[] {
  const blocked = new Set(projects.filter(p =>
    [p.assigned_group, p.draw_order, p.draw_code, p.draw_time].some(value => value != null && value !== '')
  ).map(p => p.field));
  return fields.filter(field => !blocked.has(field));
}

export function getSelectedDrawFields(fields: string[], projects: ProjectItem[], selected: string[] | null): string[] {
  const available = getAvailableDrawFields(fields, projects);
  return selected === null ? available : available.filter(field => selected.includes(field));
}
