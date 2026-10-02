import { createHmac, randomBytes } from 'node:crypto';
import { ResourceBusyError } from './resourceLimits';

type Entry = { promise: Promise<boolean>; pending: boolean; expiresAt: number };

/** Coalesce shared credentials only; cache successful verification without plaintext keys. */
export class SharedPasswordVerifier {
  private key?: Buffer;
  private readonly entries = new Map<string, Entry>();
  constructor(
    private readonly verifyCredential: (password: string, encoded: string) => Promise<boolean>,
    private readonly ttlMs = 30000,
    private readonly maxEntries = 32,
    private readonly now = Date.now,
  ) {}
  async verify(password: string, encoded: string): Promise<boolean> {
    // The full stored hash binds cache hits to the current salt/password version.
    const key = createHmac('sha256', this.key ||= randomBytes(32)).update(encoded).update('\0').update(password).digest('hex');
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.promise;
    for (const [id, entry] of this.entries) if (!entry.pending && entry.expiresAt <= this.now()) this.entries.delete(id);
    if (this.entries.size >= this.maxEntries) {
      const reusable = [...this.entries].find(([, entry]) => !entry.pending);
      if (!reusable) throw new ResourceBusyError();
      this.entries.delete(reusable[0]);
    }
    const entry: Entry = { pending: true, expiresAt: Infinity, promise: Promise.resolve(false) };
    entry.promise = Promise.resolve().then(() => this.verifyCredential(password, encoded)).then(valid => {
      // Invalidation cannot revive an earlier, still-running verification.
      if (this.entries.get(key) !== entry) return false;
      if (valid) { entry.pending = false; entry.expiresAt = this.now() + this.ttlMs; }
      else this.entries.delete(key);
      return valid;
    }, error => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      throw error;
    });
    this.entries.set(key, entry);
    return entry.promise;
  }
  invalidate(): void { this.entries.clear(); }
}
