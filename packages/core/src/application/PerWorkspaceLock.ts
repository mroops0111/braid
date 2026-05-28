import type { WorkspaceId } from '@braidhq/schema'

/**
 * Per-workspace serialisation primitive: at most one fn executes per
 * workspace at a time. Built as a promise chain keyed by workspaceId
 * so independent workspaces never block each other.
 *
 * Used by HITLService to make the load → validate → write → save chain
 * atomic per workspace. Without this two near-simultaneous applyProposal
 * calls can both pass validation against the same pre-write snapshot
 * and race on the actual graph write, leaving one client with a
 * `"already exists"` 400 even though the data is correct.
 */
export class PerWorkspaceLock {
  private readonly chains = new Map<WorkspaceId, Promise<unknown>>()

  run<T>(workspaceId: WorkspaceId, fn: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(workspaceId) ?? Promise.resolve()
    // `.then(fn, fn)` runs fn whether the predecessor resolved or rejected
    // so one workspace's failure can't deadlock the next caller.
    const result = previous.then(fn, fn)
    // Store an error-swallowing tail so the next caller doesn't see this
    // attempt's rejection (each call owns its own error).
    const tail = result.then(noop, noop)
    this.chains.set(workspaceId, tail)
    void tail.then(() => {
      // Drop the entry when nothing else has queued behind us.
      if (this.chains.get(workspaceId) === tail)
        this.chains.delete(workspaceId)
    })
    return result
  }
}

function noop(): void {}
