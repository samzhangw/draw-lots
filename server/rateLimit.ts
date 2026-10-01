import type { Request, Response, NextFunction } from 'express';
import { fingerprint } from './credentials';
import { runtimeEnv } from './runtime';
import { ApiError } from './errors';

export function loginLimiter(accountLimit = 10, ipLimit = 100, windowMs = 15 * 60 * 1000) {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const run = async () => {
      const now = Date.now();
      const shared = runtimeEnv().LOGIN_LIMITER;
      // Cloudflare sets this header at its edge; Node mode uses the socket IP.
      const ip = shared ? req.get('cf-connecting-ip') || req.ip || 'unknown' : req.ip || 'unknown';
      const ipKey = `ip:${fingerprint(ip)}`;
      const rawAccount = req.body?.leaderId ?? req.body?.username;
      const accountKey = typeof rawAccount === 'string' ? `account:${fingerprint(rawAccount.trim().toLowerCase())}` : ipKey;
      for (const key of new Set([ipKey, accountKey])) {
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
