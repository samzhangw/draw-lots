import type { ProjectItem } from '../types';

export function isCompleteDrawResult(project: ProjectItem): boolean {
  return Number.isSafeInteger(project.assigned_group) && project.assigned_group! > 0
    && Number.isSafeInteger(project.draw_order) && project.draw_order! > 0
    && typeof project.draw_code === 'string' && project.draw_code.trim().length > 0;
}

function fieldsWithDrawData(projects: ProjectItem[]): Set<string> {
  return new Set(projects.filter(p =>
    [p.assigned_group, p.draw_order, p.draw_code, p.draw_time].some(value => value != null && value !== '')
  ).map(p => p.field));
}

/** A domain with any draw data is incomplete unless every project has a full result. */
export function getIncompleteDrawFields(fields: string[], projects: ProjectItem[]): string[] {
  const started = fieldsWithDrawData(projects);
  return fields.filter(field => started.has(field) && projects.some(p => p.field === field && !isCompleteDrawResult(p)));
}

/** A partial result also blocks drawing the domain again until it is reset. */
export function getAvailableDrawFields(fields: string[], projects: ProjectItem[]): string[] {
  const blocked = fieldsWithDrawData(projects);
  return fields.filter(field => !blocked.has(field));
}

export function getSelectedDrawFields(fields: string[], projects: ProjectItem[], selected: string[] | null): string[] {
  const available = getAvailableDrawFields(fields, projects);
  return selected === null ? available : available.filter(field => selected.includes(field));
}

export function getResettableFields(fields: string[], projects: ProjectItem[]): string[] {
  const completed = fieldsWithDrawData(projects);
  return fields.filter(field => completed.has(field));
}
