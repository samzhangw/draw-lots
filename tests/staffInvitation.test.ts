import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invitationToken } from '../src/lib/staffInvitation';
import { validateInvitationInput } from '../server/staffInvitation';
const tokenHash = 'a'.repeat(64);
test('invitation accepts only a single invite hash from fragment, never arbitrary sessions or redirects', () => {
  assert.equal(invitationToken(`#token_hash=${tokenHash}&type=invite`, ''), tokenHash);
  for (const hash of ['', '#access_token=abc&refresh_token=def', `#token_hash=${tokenHash}&type=recovery`, `#token_hash=${tokenHash}&type=invite&role=admin`, `#token_hash=${tokenHash}&type=invite&type=invite`, '#token_hash=bad&type=invite']) assert.equal(invitationToken(hash, ''), null);
  assert.equal(invitationToken(`#token_hash=${tokenHash}&type=invite`, '?next=https://evil.test'), null);
});
test('invitation rejects weak passwords and all caller supplied privilege fields before verification', () => {
  assert.deepEqual(validateInvitationInput({ tokenHash, password: 'New-secure-password-123' }), { tokenHash, password: 'New-secure-password-123' });
  for (const password of ['', 'short1', 'a'.repeat(129), 'onlyletterslong', '123456789012345', {}, null]) assert.throws(() => validateInvitationInput({ tokenHash, password }));
  for (const extra of ['role', 'userId', 'email', 'type', 'access_token', 'app_metadata']) assert.throws(() => validateInvitationInput({ tokenHash, password: 'New-secure-password-123', [extra]: 'admin' }));
});
