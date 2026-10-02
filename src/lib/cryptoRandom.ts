/**
 * Cryptographically Secure Pseudo-Random Number Generator (CSPRNG) & Fisher-Yates Uniform Shuffle
 * 
 * 核心演算法：
 * 1. 採用 globalThis.crypto.getRandomValues()；不可用時拒絕抽籤，不使用非安全亂數。
 * 2. 實作 Rejection Sampling (拒絕取樣) 機制，徹底消除 Modulo Bias (模運算偏差)。
 * 3. 採用標準 Fisher-Yates (Knuth) 洗牌演算法，確保每一種排列組合出現的機率嚴格均等 (1/n!)。
 */

/**
 * Check if Web Crypto API getRandomValues is available in the current environment
 */
export function isCSPRNGSupported(): boolean {
  return typeof globalThis !== 'undefined' &&
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.getRandomValues === 'function';
}

export class SecureRandomUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('安全亂數服務暫時無法使用，抽籤已停止，請稍後再試。', { cause });
    this.name = 'SecureRandomUnavailableError';
  }
}

function requireCSPRNG(): void {
  if (!isCSPRNGSupported()) throw new SecureRandomUnavailableError();
}

function fillSecureRandom(buffer: Uint32Array<ArrayBuffer>): void {
  requireCSPRNG();
  try {
    globalThis.crypto.getRandomValues(buffer);
  } catch (error) {
    throw new SecureRandomUnavailableError(error);
  }
}

/** Uniform integer in [0, max), with rejection sampling to avoid modulo bias. */
export function getSecureRandomInt(max: number): number {
  if (!Number.isInteger(max) || max < 1 || max > 0x100000000) {
    throw new RangeError('亂數上限須為 1 至 2^32 的整數。');
  }
  requireCSPRNG();
  if (max === 1) return 0;
  const buffer = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / max) * max;
  let rand: number;
  do {
    fillSecureRandom(buffer);
    rand = buffer[0];
  } while (rand >= limit);
  return rand % max;
}

/** Uniform floating point number in [0, 1), with 53 bits of precision. */
export function getSecureRandomFloat(): number {
  const buffer = new Uint32Array(2);
  fillSecureRandom(buffer);
  const hi = buffer[0] >>> 11;
  const lo = buffer[1];
  return (hi * 4294967296 + lo) / 9007199254740992;
}

/**
 * Standard Fisher-Yates (Knuth) modern uniform shuffle algorithm
 * Time complexity: O(n)
 * Space complexity: O(n) (returns a new shuffled array without mutating the original)
 * 
 * Mathematical guarantee: Every one of the n! permutations has exact 1/n! probability.
 */
export function secureFisherYatesShuffle<T>(array: readonly T[]): T[] {
  requireCSPRNG();
  if (!array || array.length <= 1) {
    return array ? [...array] : [];
  }

  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    // Select j uniformly from [0, i] (inclusive)
    const j = getSecureRandomInt(i + 1);
    // Swap elements at indices i and j
    const temp = result[i];
    result[i] = result[j];
    result[j] = temp;
  }

  return result;
}

/**
 * Securely select a single random element from an array with uniform probability
 */
export function securePickOne<T>(array: readonly T[]): T | undefined {
  requireCSPRNG();
  if (!array || array.length === 0) return undefined;
  const index = getSecureRandomInt(array.length);
  return array[index];
}

/**
 * Calculate a SHA-256 fingerprint of a given string payload for tamper verification
 */
export async function calculateSHA256(payload: string): Promise<string> {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle?.digest) {
    try {
      const msgUint8 = new TextEncoder().encode(payload);
      const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', msgUint8);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // Fallback
    }
  }
  // Simple deterministic fallback hash if SubtleCrypto is unavailable
  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    const char = payload.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(16, '0');
}
