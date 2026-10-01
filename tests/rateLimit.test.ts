import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response, NextFunction } from 'express';
import { loginLimiter } from '../server/rateLimit';
import { withRuntime } from '../server/runtime';

test('campus IP permits 300 distinct student logins while each account and staff retain tight limits', async () => {
  const counts = new Map<string, number>();
  const names = new Set<string>();
  const shared = {
    idFromName(name: string) { names.add(name); return name; },
    get(name: string) {
      return {
        async fetch(_url: string, init: { body: string }) {
          const { limit } = JSON.parse(init.body) as { limit: number };
          const count = counts.get(name) || 0;
          if (count >= limit) return Response.json({ success: false, retryAfter: 60 });
          counts.set(name, count + 1);
          return Response.json({ success: true, retryAfter: 0 });
        },
      };
    },
  };
  const student = loginLimiter('student', 10, 600);
  const staff = loginLimiter('staff');
  const attempt = (middleware: ReturnType<typeof loginLimiter>, account: string) => withRuntime(
    { LOGIN_LIMITER: shared as any },
    () => new Promise<number>((resolve, reject) => {
      const req = {
        ip: '127.0.0.1', body: { leaderId: account, username: account },
        get: (header: string) => header === 'cf-connecting-ip' ? '203.0.113.1' : undefined,
      } as unknown as Request;
      let statusCode = 200;
      const res = {
        setHeader() {},
        status(code: number) { statusCode = code; return this; },
        json() { resolve(statusCode); return this; },
      } as unknown as Response;
      middleware(req, res, ((error?: unknown) => error ? reject(error) : resolve(200)) as NextFunction);
    }),
  );

  for (let i = 0; i < 300; i++) assert.equal(await attempt(student, `student-${i}`), 200);
  for (let i = 0; i < 10; i++) assert.equal(await attempt(student, 'repeated-student'), 200);
  assert.equal(await attempt(student, 'repeated-student'), 429);
  assert.equal(counts.get([...names].find(name => name.startsWith('student:ip:'))!), 310);
  for (let i = 0; i < 100; i++) assert.equal(await attempt(staff, `staff-${i}`), 200);
  assert.equal(await attempt(staff, 'staff-over-limit'), 429);
  assert.ok([...names].some(name => name.startsWith('student:ip:')));
  assert.ok([...names].some(name => name.startsWith('staff:ip:')));
});
