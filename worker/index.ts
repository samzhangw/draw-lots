import { createServer } from 'node:http';
import { handleAsNodeRequest } from 'cloudflare:node';
import type { DurableObjectNamespace, DurableObjectState, Fetcher } from '@cloudflare/workers-types/index.ts';
import { fingerprint } from '../server/credentials';
import { app } from '../server/app';
import { withRuntime, type RuntimeEnvironment } from '../server/runtime';

interface Env extends RuntimeEnvironment { ASSETS: Fetcher; LOGIN_LIMITER: DurableObjectNamespace; API_BACKEND: DurableObjectNamespace; }
createServer(app).listen(8080);
export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    const isApi = url.pathname === '/api' || url.pathname.startsWith('/api/');
    if (url.protocol !== 'https:') {
      if (isApi) return new Response('HTTPS required', { status: 403 });
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 308);
    }

    const forward = { method: request.method, headers: Object.fromEntries(request.headers) };
    let response;
    if (!isApi) {
      response = await env.ASSETS.fetch(request.url, forward);
    } else {
      const shard = parseInt(fingerprint(request.headers.get('cf-connecting-ip') || 'local').slice(0, 2), 16) % 32;
      response = await env.API_BACKEND.get(env.API_BACKEND.idFromName(`api-${shard}`)).fetch(request.url, { ...forward, body: request.body });
    }
    const secureResponse = new Response(response.body as unknown as ReadableStream<Uint8Array> | null, response as unknown as Response);
    secureResponse.headers.set('Strict-Transport-Security', 'max-age=31536000');
    secureResponse.headers.set('X-Content-Type-Options', 'nosniff');
    secureResponse.headers.set('X-Frame-Options', 'DENY');
    return secureResponse;
  },
};

// Give password hashing the DO CPU budget; all business data still stays in Supabase.
export class ApiBackend {
  constructor(private ctx: DurableObjectState, private env: Env) {}
  async fetch(request: Request) {
    return this.ctx.blockConcurrencyWhile(() => withRuntime(
      { ...this.env, NODE_ENV: 'production' }, () => handleAsNodeRequest(8080, request),
    ));
  }
}

// Shared atomic counters survive isolate restarts. Only hashed account/IP keys are used.
export class LoginLimiter {
  constructor(private ctx: DurableObjectState) {}
  async fetch(request: Request) {
    const { limit, windowMs } = await request.json() as { limit: number; windowMs: number };
    const now = Date.now();
    const result = await this.ctx.storage.transaction(async tx => {
      const stored = await tx.get<{ count: number; resetAt: number }>('bucket');
      const bucket = stored && stored.resetAt > now ? stored : { count: 0, resetAt: now + windowMs };
      if (bucket.count >= limit) return { success: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
      bucket.count++;
      await tx.put('bucket', bucket);
      await tx.setAlarm(bucket.resetAt);
      return { success: true, retryAfter: 0 };
    });
    return Response.json(result);
  }
  async alarm() { await this.ctx.storage.deleteAll(); }
}
