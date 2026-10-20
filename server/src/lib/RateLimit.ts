/**
 * Locks a key out for a while after too many failed attempts. Used for PIN and password checks.
 */
export class RateLimit {
  private _attempts = new Map<string, { failures: number; lockedUntil: number }>();

  /**
   * @param maxFailures Failed attempts allowed before locking.
   * @param lockSeconds How long a lock lasts. Unit is in seconds.
   */
  constructor(private maxFailures: number, private lockSeconds: number) { }

  /**
   * Seconds left on the lock for `key`, or `0` when it may try again.
   */
  public lockedFor(key: string) {
    const entry = this._attempts.get(key);
    if (!entry) return 0;
    return Math.max(0, Math.ceil((entry.lockedUntil - Date.now()) / 1000));
  }

  public fail(key: string) {
    const entry = this._attempts.get(key) ?? { failures: 0, lockedUntil: 0 };
    entry.failures++;
    if (entry.failures >= this.maxFailures) {
      entry.failures = 0;
      entry.lockedUntil = Date.now() + this.lockSeconds * 1000;
    }
    this._attempts.set(key, entry);
  }

  public reset(key: string) {
    this._attempts.delete(key);
  }
}

export default RateLimit;
