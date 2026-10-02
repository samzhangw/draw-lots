import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSecureRandomInt, getSecureRandomFloat, secureFisherYatesShuffle, securePickOne, SecureRandomUnavailableError } from '../src/lib/cryptoRandom';
import { allocateDomainSubgroups } from '../src/lib/lottery';
import { publicError } from '../server/errors';
import type { ProjectItem } from '../src/types';

function withCrypto(value: unknown, run: () => void) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value });
  try { run(); } finally {
    if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
    else Reflect.deleteProperty(globalThis, 'crypto');
  }
}

test('missing or broken secure randomness stops selection and lottery without touching inputs', () => {
  const projects = [{ id: 'p1', field: '企業智慧化', advisor: '' }, { id: 'p2', field: '企業智慧化', advisor: '' }] as ProjectItem[];
  const before = structuredClone(projects);
  const originalRandom = Math.random;
  Math.random = () => { assert.fail('insecure random fallback must never be called'); };
  try {
    for (const crypto of [undefined, {}, { getRandomValues() { throw new Error('private provider detail'); } }]) {
      withCrypto(crypto, () => {
        assert.throws(() => getSecureRandomInt(10), SecureRandomUnavailableError);
        assert.throws(() => getSecureRandomFloat(), SecureRandomUnavailableError);
        assert.throws(() => secureFisherYatesShuffle(projects), SecureRandomUnavailableError);
        assert.throws(() => securePickOne(projects), SecureRandomUnavailableError);
        assert.throws(() => allocateDomainSubgroups(projects, 2, '企業智慧化'), SecureRandomUnavailableError);
        assert.deepEqual(projects, before);
      });
    }
    withCrypto(undefined, () => {
      assert.throws(() => getSecureRandomInt(1), SecureRandomUnavailableError);
      assert.throws(() => secureFisherYatesShuffle([1]), SecureRandomUnavailableError);
      assert.throws(() => secureFisherYatesShuffle([]), SecureRandomUnavailableError);
    });
  } finally { Math.random = originalRandom; }
  const response = publicError(new SecureRandomUnavailableError(new Error('private provider detail')), 'test-id');
  assert.equal(response.status, 503);
  assert.match(response.body.error, /抽籤已停止/);
  assert.equal(JSON.stringify(response.body).includes('private provider detail'), false);
});

test('secure integer rejects biased values and invalid bounds; shuffle preserves its source', () => {
  const values = [0xffffffff, 5];
  let calls = 0;
  withCrypto({ getRandomValues(buffer: Uint32Array) { buffer[0] = values[calls++]; return buffer; } }, () => {
    assert.equal(getSecureRandomInt(3), 2);
    assert.equal(calls, 2); // 2^32 - 1 must be rejected rather than reduced modulo 3.
  });
  for (const bound of [0, -1, NaN, Infinity, 1.5, 0x100000001]) assert.throws(() => getSecureRandomInt(bound), RangeError);
  assert.equal(getSecureRandomInt(1), 0);
  const source = [1, 2, 3, 4];
  const shuffled = secureFisherYatesShuffle(source);
  assert.deepEqual(source, [1, 2, 3, 4]);
  assert.deepEqual([...shuffled].sort(), source);
  assert.notEqual(shuffled, source);
  withCrypto({ getRandomValues(buffer: Uint32Array) { buffer.fill(0xffffffff); return buffer; } }, () => {
    assert.equal(getSecureRandomInt(0x100000000), 0xffffffff);
    assert.equal(getSecureRandomFloat(), 1 - 2 ** -53);
  });
});
