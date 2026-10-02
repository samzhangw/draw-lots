import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiRequest, ApiRequestError } from '../src/lib/api';
import { getAuthSession, saveAuthSession, clearAuthSession } from '../src/lib/auth';

test('network failures show Chinese messages without clearing the staff session', async () => {
  const originalFetch = globalThis.fetch;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalSession = getAuthSession();
  const session = { role: 'admin' as const, username: 'preview', displayName: '管理員', loginTime: '', expiresAt: 9999999999 };
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  saveAuthSession(session);
  try {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
    await assert.rejects(apiRequest('/api/state'), (error: unknown) => {
      assert.ok(error instanceof ApiRequestError);
      assert.equal(error.status, 0);
      assert.equal(error.message, '目前沒有網路連線，請檢查 Wi-Fi 或行動網路。');
      return true;
    });
    assert.equal(getAuthSession(), session);

    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
    await assert.rejects(apiRequest('/api/student/me'), /無法連線至伺服器，請檢查網路連線或稍後再試。/);
    await assert.rejects(apiRequest('/api/lottery/draw', { field: 'ALL', version: 1 }), /無法確認操作是否完成，恢復連線後請重新載入確認結果/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else Reflect.deleteProperty(globalThis, 'navigator');
    if (originalSession) saveAuthSession(originalSession);
    else clearAuthSession();
  }
});

test('server validation messages and status remain available', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ success: false, error: '資料已更新，請重新整理。' }), { status: 409 });
  try {
    await assert.rejects(apiRequest('/api/projects', { version: 1 }), (error: unknown) => {
      assert.ok(error instanceof ApiRequestError);
      assert.equal(error.status, 409);
      assert.equal(error.message, '資料已更新，請重新整理。');
      return true;
    });
  } finally { globalThis.fetch = originalFetch; }
});
