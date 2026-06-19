// A basic in-memory mutex to handle the hot wallet nonce bottleneck.
// If two users request a withdrawal at the same time, we'd get duplicate nonces
// and one of the transactions would drop. This forces them to queue up sequentially.
// Note: This only works for a single instance. If we scale to multiple instances,
// we'll need Redis or a proper nonce manager.
export class Mutex {
  private mutex = Promise.resolve();

  // Grabs the lock and returns a cleanup/unlock function.
  lock(): Promise<() => void> {
    let begin: (unlock: () => void) => void = () => {};
    this.mutex = this.mutex.then(() => new Promise(begin));
    return new Promise(res => {
      begin = res;
    });
  }
}

// Locks execution for a specific key (like a userId).
// This stops race conditions on a single user's balance checks and ledger writes,
// without blocking other users from withdrawing at the same time.
export class KeyedMutex {
  private locks = new Map<string, Promise<void>>();

  // Grabs the lock for a specific key (e.g. userId) and returns an unlock trigger.
  async lock(key: string): Promise<() => void> {
    let resolveLock: () => void = () => {};
    const newLock = new Promise<void>((resolve) => {
      resolveLock = resolve;
    });

    const currentLock = this.locks.get(key) || Promise.resolve();
    this.locks.set(key, currentLock.then(() => newLock));

    await currentLock;

    return () => {
      resolveLock();
      // Keep memory clean by removing keys that are no longer locked
      if (this.locks.get(key) === newLock) {
        this.locks.delete(key);
      }
    };
  }
}
