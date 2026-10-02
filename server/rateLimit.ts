import type { Request, Response, NextFunction } from 'express';
import { fingerprint } from './credentials';
import { runtimeEnv } from './runtime';
import { ApiError } from './errors';

export function loginLimiter(scope: 'staff' | 'student', accountLimit = 10, ipLimit = 100, windowMs = 15 * 60 * 1000) {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const run = async () => {
      // Use exactly the account field consumed by this scope's authentication.
      // Extra fields must not select another bucket or disable account limiting.
      const rawAccount = scope === 'staff' ? req.body?.username : req.body?.leaderId;
      const maxLength = scope === 'staff' ? 256 : 128;
      if (typeof rawAccount !== 'string' || !rawAccount.trim() || rawAccount.length > maxLength) {
        throw new ApiError(400, scope === 'staff' ? '請輸入有效的登入 Email。' : '請輸入有效的組長學號。');
      }
      const now = Date.now();
      const shared = runtimeEnv().LOGIN_LIMITER;
      // Cloudflare sets this header at its edge; Node mode uses the socket IP.
      const ip = shared ? req.get('cf-connecting-ip') || req.ip || 'unknown' : req.ip || 'unknown';
      const ipKey = `${scope}:ip:${fingerprint(ip)}`;
      const accountKey = `${scope}:account:${fingerprint(rawAccount.trim().toLowerCase())}`;
      // Reject repeated guesses for one account before they consume the campus IP pool.
      for (const key of new Set([accountKey, ipKey])) {
        const limit = key === ipKey ? ipLimit : accountLimit;
        if (shared) {
          const result = await shared.get(shared.idFromName(key)).fetch('https://limiter/check', {
            method: 'POST', body: JSON.stringify({ limit, windowMs }),
          });
          if (!result.ok) throw new ApiError(503, '登入服務暫時無法使用。');
          const decision = await result.json() as { success: boolean; retryAfter: number };
          if (!decision.success) {
            res.setHeader('Retry-After', decision.retryAfter);
            res.status(429).json({ success: false, error: '登入嘗試過於頻繁，請稍後再試。' }); return;
          }
        } else {
          // Local Node fallback; no startup timers in the Workers bundle.
          for (const [id, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(id);
          const old = buckets.get(key);
          const bucket = old && old.resetAt > now ? old : { count: 0, resetAt: now + windowMs };
          if (bucket.count >= limit) {
            res.setHeader('Retry-After', Math.ceil((bucket.resetAt - now) / 1000));
            res.status(429).json({ success: false, error: '登入嘗試過於頻繁，請稍後再試。' }); return;
          }
          if (buckets.size >= 10000 && !buckets.has(key)) { res.status(429).json({ success: false, error: '登入服務忙碌，請稍後再試。' }); return; }
          bucket.count++; buckets.set(key, bucket);
        }
      }
      next();
    };
    void run().catch(next);
  };
}
