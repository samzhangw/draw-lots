import { clearAuthSession, getAuthSession } from './auth';
import type { ProjectItem, DomainConfig } from '../types';

export interface StoreState {
  projects: ProjectItem[];
  domainConfigs: DomainConfig[];
  version: number;
  lastUpdated: string;
  sharedPasswordEnabled: boolean;
}
export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = 'ApiRequestError'; }
}

export async function apiRequest<T = StoreState>(url: string, body?: Record<string, unknown>): Promise<T> {
  const session = getAuthSession();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET', headers, credentials: 'same-origin',
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) {
    if (res.status === 401 && session && !url.startsWith('/api/student/') && url !== '/api/auth/verify') {
      clearAuthSession();
      window.dispatchEvent(new Event('auth-expired'));
    }
    throw new ApiRequestError(data?.error || data?.message || `伺服器連線失敗 (HTTP ${res.status})`, res.status);
  }
  return data as T;
}
