import type { WorkspaceId } from '@braidhq/schema'

/**
 * Per-workspace serialisation primitive,
 * at most one task executes per workspace at a time.
 * Built as a promise chain keyed by workspaceId, so workspaces never block.
 *
 * Used by HITLService to make the load, validate, write, save chain atomic.
 * Without this, two applyProposal calls could pass the same pre-write snapshot,
 * then race on the graph write, leaving one client a spurious `"already exists"` 400.
 */
export class PerWorkspaceLock {
  private readonly chains = new Map<WorkspaceId, Promise<unknown>>()

  run<T>(workspaceId: WorkspaceId, task: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(workspaceId) ?? Promise.resolve()
    // `.then(task, task)` runs task whether the predecessor resolved or rejected,
    // so one workspace's failure can't deadlock the next caller.
    const result = previous.then(task, task)
    // Store an error-swallowing tail,
    // so the next caller doesn't see this attempt's rejection.
    // Each call owns its own error.
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
