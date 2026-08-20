/**
 * Runs at most one task per key at a time,
 * and hands every caller that arrives while one is running the same result.
 *
 * The sibling `WorkspaceLock` queues instead,
 * so a second caller runs the task again once the first finishes.
 * That is right for writes, where each caller has its own work to do.
 * It is wrong for a refresh,
 * where three deliveries landing together should cost one fetch, not three.
 *
 * A rejection propagates to every caller that joined it,
 * and the key is released either way,
 * so the next arrival starts a fresh attempt.
 */
export class TaskCoalescer {
  private readonly inFlight = new Map<string, Promise<unknown>>()

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const joined = this.inFlight.get(key)
    if (joined)
      return joined as Promise<T>
    // Release inside the returned promise's own chain,
    // so a caller that awaits and asks again starts a fresh pass,
    // rather than joining a settled one.
    // Cleaning up in a detached `.then` resumes the caller first,
    // and hands the next arrival a stale entry.
    //
    // Deleting unconditionally is safe.
    // A key is only ever set while the map has no entry for it,
    // so nothing newer can exist to clobber here.
    const released = Promise.resolve().then(task).finally(() => {
      this.inFlight.delete(key)
    })
    this.inFlight.set(key, released)
    return released
  }
}
