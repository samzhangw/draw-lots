import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, publicError } from '../server/errors';

const sensitive = 'password=private-value; table=ntcust_lottery_state; /server/private.ts:123';
test('internal exceptions and all server error messages stay out of public responses', () => {
  for (const error of [new Error(sensitive), new ApiError(500, sensitive), new ApiError(503, sensitive), { status: 403, message: sensitive, stack: sensitive }, sensitive, null, undefined]) {
    const response = publicError(error, 'test-request-id');
    assert.ok(response.status >= 500);
    assert.equal(response.body.requestId, 'test-request-id');
    assert.equal(JSON.stringify(response).includes(sensitive), false);
    assert.deepEqual(Object.keys(response.body).sort(), ['error', 'requestId', 'success']);
  }
});
test('safe validation errors retain their status and malformed JSON never echoes submitted data', () => {
  const validation = publicError(new ApiError(409, '資料已更新，請重新整理。'), 'validation-request');
  assert.equal(validation.status, 409); assert.equal(validation.body.error, '資料已更新，請重新整理。');
  for (const [type, status] of [['entity.parse.failed', 400], ['entity.too.large', 413]] as const) {
    const response = publicError({ type, status, body: sensitive, message: sensitive }, 'parse-request');
    assert.equal(response.status, status); assert.equal(JSON.stringify(response).includes(sensitive), false);
  }
});
