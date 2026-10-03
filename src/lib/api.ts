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
export class ApiRequestCancelledError extends ApiRequestError {
  constructor() { super('請求已取消。', 0); this.name = 'ApiRequestCancelledError'; }
}
export const isApiRequestCancelled = (error: unknown): error is ApiRequestCancelledError => error instanceof ApiRequestCancelledError;
export interface ApiRequestOptions { signal?: AbortSignal; timeoutMs?: number; }
export const API_TIMEOUTS = { read: 15000, login: 45000, write: 60000 } as const;
export function requestTimeoutMs(url: string, writing: boolean): number {
  return ['/api/auth/verify', '/api/student/verify'].includes(url) ? API_TIMEOUTS.login
    : writing ? API_TIMEOUTS.write : API_TIMEOUTS.read;
}

export async function apiRequest<T = StoreState>(url: string, body?: Record<string, unknown>, options: ApiRequestOptions = {}): Promise<T> {
  const session = getAuthSession();
  const timeoutMs = options.timeoutMs ?? requestTimeoutMs(url, !!body);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError('請求期限必須為正數。');
  if (options.signal?.aborted) throw new ApiRequestCancelledError();
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  let rejectAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = () => reject(timedOut ? new ApiRequestError(body
      ? '操作等候逾時，無法確認是否已完成。請重新載入確認登入狀態或資料結果，再決定是否重試；請勿直接重複送出。'
      : '讀取逾時，請檢查網路連線後再試。', 0) : new ApiRequestCancelledError());
    controller.signal.addEventListener('abort', rejectAbort, { once: true });
  });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  options.signal?.addEventListener('abort', cancel, { once: true });
  try {
    // Deadline covers both response headers and body. Race also prevents a late
    // response from changing auth/state if a transport ignores cancellation.
    const { res, data } = await Promise.race([
      (async () => {
        const res = await fetch(url, {
          method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', signal: controller.signal,
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        const data = await res.json().catch(error => { if (controller.signal.aborted) throw error; return null; });
        return { res, data };
      })(), aborted,
    ]);
    if (!res.ok || !data?.success) {
      if (res.status === 401 && session && getAuthSession() === session && !url.startsWith('/api/student/') && url !== '/api/auth/verify') {
        clearAuthSession();
        window.dispatchEvent(new Event('auth-expired'));
      }
      throw new ApiRequestError(data?.error || data?.message || `伺服器連線失敗 (HTTP ${res.status})`, res.status);
    }
    return data as T;
  } catch (error) {
    if (error instanceof ApiRequestError) throw error;
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    const message = offline ? '目前沒有網路連線，請檢查 Wi-Fi 或行動網路。' : '無法連線至伺服器，請檢查網路連線或稍後再試。';
    throw new ApiRequestError(body ? `${message}無法確認操作是否完成，恢復連線後請重新載入確認結果，再決定是否重試。` : message, 0);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
    controller.signal.removeEventListener('abort', rejectAbort);
  }
}
