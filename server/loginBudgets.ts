export type LoginBudget = { key: string; limit: number };
export type LoginBucket = { count: number; resetAt: number };
export type LoginDecision = { success: boolean; retryAfter: number; challenge?: boolean };

// No mutation on rejection. IP checks precede account risk checks.
export function decideLoginBudgets(budgets: LoginBudget[], stored: Map<string, LoginBucket>, now: number, windowMs: number, proof: boolean) {
  const current = budgets.map(b => {
    const value = stored.get(b.key);
    return value && value.resetAt > now ? value : { count: 0, resetAt: now + windowMs };
  });
  if (current[0].count >= budgets[0].limit) return { decision: { success: false, retryAfter: Math.ceil((current[0].resetAt - now) / 1000) } as LoginDecision };
  if (!proof && current[1].count >= budgets[1].limit) return { decision: { success: false, retryAfter: 0, challenge: true } as LoginDecision };
  const updates = new Map(budgets.map((b, i) => [b.key, { count: Math.min(current[i].count + 1, b.limit), resetAt: current[i].resetAt }]));
  return { decision: { success: true, retryAfter: 0 } as LoginDecision, updates };
}
