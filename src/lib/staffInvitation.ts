export function invitationToken(hash: string, search: string): string | null {
  const fragment = new URLSearchParams(hash.replace(/^#/, ''));
  // Only invitation hashes are accepted. Access/refresh tokens and other OTP types are rejected.
  const query = new URLSearchParams(search);
  if (query.size || fragment.size !== 2 || fragment.get('type') !== 'invite') return null;
  const token = fragment.get('token_hash');
  return token && /^[a-f0-9]{40,128}$/i.test(token) ? token : null;
}
