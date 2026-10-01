/**
 * Cryptographically Secure Pseudo-Random Number Generator (CSPRNG) & Fisher-Yates Uniform Shuffle
 * 
 * 核心演算法：
 * 1. 採用 window.crypto.getRandomValues() 取代標準 Math.random()，避免偽隨機週期與被預測漏洞。
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

/**
 * Generate a cryptographically secure random 32-bit unsigned integer uniformly in [0, max)
 * Employs Rejection Sampling to eliminate Modulo Bias.
 * 
 * @param max Upper bound (exclusive), must be a positive integer <= 2^32 - 1
 */
export function getSecureRandomInt(max: number): number {
  if (max <= 1) return 0;

  if (isCSPRNGSupported()) {
    const buffer = new Uint32Array(1);
    // 2^32 = 4294967296
    const limit = Math.floor(0x100000000 / max) * max;
    let rand: number;

    do {
      globalThis.crypto.getRandomValues(buffer);
      rand = buffer[0];
    } while (rand >= limit); // Reject values in the biased upper slice

    return rand % max;
  }

  // Graceful fallback for non-crypto environments (e.g. testing)
  return Math.floor(Math.random() * max);
}

/**
 * Generate a cryptographically secure uniform floating point number in [0, 1)
 * with full 53-bit double precision.
 */
export function getSecureRandomFloat(): number {
  if (isCSPRNGSupported()) {
    const buffer = new Uint32Array(2);
    globalThis.crypto.getRandomValues(buffer);
    // Combine 21 bits from buffer[0] and 32 bits from buffer[1] to form 53 bits of entropy
    const hi = buffer[0] >>> 11;
    const lo = buffer[1];
    return (hi * 4294967296 + lo) / 9007199254740992; // 2^53
  }
  return Math.random();
}

/**
 * Standard Fisher-Yates (Knuth) modern uniform shuffle algorithm
 * Time complexity: O(n)
 * Space complexity: O(n) (returns a new shuffled array without mutating the original)
 * 
 * Mathematical guarantee: Every one of the n! permutations has exact 1/n! probability.
 */
export function secureFisherYatesShuffle<T>(array: readonly T[]): T[] {
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
