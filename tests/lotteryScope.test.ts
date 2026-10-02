import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLotteryFields } from '../server/lotteryScope';

test('lottery scope accepts multiple known fields and preserves legacy all/single requests', () => {
  assert.deepEqual([...resolveLotteryFields({ fields: ['C', 'A'] }, ['A', 'B', 'C'])], ['C', 'A']);
  assert.deepEqual([...resolveLotteryFields({ field: 'B' }, ['A', 'B'])], ['B']);
  assert.deepEqual([...resolveLotteryFields({}, ['A', 'B'])], ['A', 'B']);
});
test('malformed, empty, duplicate, unknown and ambiguous scopes are rejected', () => {
  for (const body of [{ fields: [] }, { fields: 'A' }, { fields: ['A', 'A'] }, { fields: ['missing'] }, { fields: [null] }, { fields: ['A'], field: 'ALL' }, { field: {} }, { field: '' }]) {
    assert.throws(() => resolveLotteryFields(body, ['A', 'B']), (error: any) => error.status === 400);
  }
});
