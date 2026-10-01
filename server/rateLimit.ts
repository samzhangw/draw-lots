import type { Request, Response, NextFunction } from 'express';
import { fingerprint } from './credentials';

// Per-process guard. Multi-replica deployments should also use shared proxy/Redis rate limits.
export function loginLimiter(accountLimit = 10, ipLimit = 100, windowMs = 15 * 60 * 1000) {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  const timer = setInterval(() => { for (const [key, bucket] of buckets) if (bucket.resetAt <= Date.now()) buckets.delete(key); }, windowMs);
  timer.unref();
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const ipKey = `ip:${req.ip}`; // Do not trust unconfigured X-Forwarded-For.
    const rawAccount = req.body?.leaderId ?? req.body?.username;
    const accountKey = typeof rawAccount === 'string' ? `account:${fingerprint(rawAccount.trim().toLowerCase())}` : ipKey;
    for (const key of new Set([ipKey, accountKey])) {
      const old = buckets.get(key);
      const bucket = old && old.resetAt > now ? old : { count: 0, resetAt: now + windowMs };
      if (bucket.count >= (key === ipKey ? ipLimit : accountLimit)) {
        res.setHeader('Retry-After', Math.ceil((bucket.resetAt - now) / 1000));
        res.status(429).json({ success: false, error: '登入嘗試過於頻繁，請稍後再試。' }); return;
      }
      if (buckets.size >= 10000 && !buckets.has(key)) { res.status(429).json({ success: false, error: '登入服務忙碌，請稍後再試。' }); return; }
      bucket.count++; buckets.set(key, bucket);
    }
    next();
  };
}
