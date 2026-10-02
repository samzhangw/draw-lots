import { ApiError } from './errors';

/** Validate before any allocation or write. Old single-field clients remain supported. */
export function resolveLotteryFields(body: Record<string, unknown>, available: string[]): Set<string> {
  if (body.fields !== undefined) {
    if (body.field !== undefined || !Array.isArray(body.fields) || !body.fields.length || body.fields.length > available.length ||
        body.fields.some(field => typeof field !== 'string' || !available.includes(field)) || new Set(body.fields).size !== body.fields.length) {
      throw new ApiError(400, '請勾選至少一個有效領域，領域不可重複。');
    }
    return new Set(body.fields as string[]);
  }
  const field = body.field ?? 'ALL';
  if (typeof field !== 'string' || (field !== 'ALL' && !available.includes(field))) throw new ApiError(400, '請選擇有效的抽籤領域。');
  return new Set(field === 'ALL' ? available : [field]);
}
