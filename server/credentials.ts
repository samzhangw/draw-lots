import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import type { ProjectItem } from '../src/types';
import { ApiError } from './errors';

export type StoredProject = ProjectItem & { password_hash?: string };
const COST = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const HASH_FORMAT = /^scrypt-v1\$([a-f0-9]{32})\$([a-f0-9]{64})$/;
const derive = (password: string, salt: string) => new Promise<Buffer>((resolve, reject) => {
  scrypt(password, salt, 32, COST, (error, result) => error ? reject(error) : resolve(result));
});

export function validatePassword(password: string, leaderId: string): void {
  if (password.trim().length < 12 || password.length > 128 || password === leaderId || password === leaderId.slice(-4)) {
    throw new ApiError(400, '學生密碼須為 12 至 128 字元，不可使用學號或學號後四碼。');
  }
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  return `scrypt-v1$${salt}$${(await derive(password, salt)).toString('hex')}`;
}
export async function verifyPassword(password: string, encoded?: string): Promise<boolean> {
  const match = typeof encoded === 'string' ? encoded.match(HASH_FORMAT) : null;
  // Also derive for unknown accounts, avoiding a cheap timing distinction.
  const actual = await derive(password, match?.[1] || '0'.repeat(32));
  return !!match && timingSafeEqual(actual, Buffer.from(match[2], 'hex'));
}
export function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// Explicit allowlist: no password, hash, arbitrary Excel columns or future private fields in DTOs.
export function projectDto(p: ProjectItem): ProjectItem {
  return {
    id: p.id, seq_no: p.seq_no, education_system: p.education_system, department: p.department,
    class_name: p.class_name, advisor: p.advisor, field: p.field, original_code: p.original_code,
    project_title: p.project_title, leader_id: p.leader_id,
    assigned_group: p.assigned_group ?? null, draw_order: p.draw_order ?? null,
    draw_code: p.draw_code ?? null, draw_time: p.draw_time ?? null, evaluators: p.evaluators || [],
  };
}

// Existing plaintext credentials are considered compromised and must be reset.
export function removeLegacyCredentials(projects: StoredProject[]): StoredProject[] {
  return projects.map(p => ({
    ...projectDto(p),
    ...(!p.password && typeof p.password_hash === 'string' && HASH_FORMAT.test(p.password_hash) ? { password_hash: p.password_hash } : {}),
  }));
}

export async function prepareProjects(input: ProjectItem[], existing: StoredProject[]): Promise<StoredProject[]> {
  const oldById = new Map(removeLegacyCredentials(existing).map(p => [p.id, p]));
  // Validate the whole batch before spending CPU on password hashing.
  for (const p of input) if (p.password) validatePassword(p.password, p.leader_id);
  const result: StoredProject[] = [];
  for (const p of input) {
    const old = oldById.get(p.id);
    const hash = p.password ? await hashPassword(p.password)
      : old?.leader_id === p.leader_id ? old.password_hash : undefined;
    result.push({ ...projectDto(p), ...(hash ? { password_hash: hash } : {}) });
  }
  return result;
}
