import type { ProjectItem } from '../types';

// Replacing a roster preserves existing students' stable project/session IDs.
export function preserveImportedProjectIds(imported: ProjectItem[], existing: ProjectItem[]): ProjectItem[] {
  const byLeader = new Map(existing.map(project => [project.leader_id.trim().toLowerCase(), project.id]));
  return imported.map(project => ({ ...project, id: byLeader.get(project.leader_id.trim().toLowerCase()) || project.id }));
}
