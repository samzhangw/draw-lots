import type { DurableObjectNamespace } from '@cloudflare/workers-types/index.ts';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RuntimeEnvironment {
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_ANON_KEY?: string;
  NODE_ENV?: string;
  PASSWORD_HASH_CONCURRENCY?: string;
  CAMPUS_NETWORK_ONLY?: string;
  LOGIN_LIMITER?: DurableObjectNamespace;
}
const context = new AsyncLocalStorage<RuntimeEnvironment>();
export function runtimeEnv(): RuntimeEnvironment { return context.getStore() || process.env; }
export function withRuntime<T>(env: RuntimeEnvironment, fn: () => T): T { return context.run(env, fn); }
