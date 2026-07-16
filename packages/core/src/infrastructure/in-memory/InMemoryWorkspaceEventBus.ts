import type { WorkspaceEvent, WorkspaceId } from '@braidhq/schema'
import type { WorkspaceEventBus, WorkspaceEventListener } from '../../application/WorkspaceEventBus.js'

/**
 * Process-local pub/sub. Holds listeners in a `Map<WorkspaceId, Set<listener>>`,
 * so unsubscribe is O(1) and publish to one workspace skips other workspaces.
 * Tier 1 single-process deployment is enough.
 * SaaS with multiple server instances will need a real broker,
 * e.g. Redis pub/sub or NATS, behind this interface.
 */
export class InMemoryWorkspaceEventBus implements WorkspaceEventBus {
  private readonly listeners = new Map<WorkspaceId, Set<WorkspaceEventListener>>()

  publish(event: WorkspaceEvent): void {
    const subscribers = this.listeners.get(event.workspaceId)
    if (!subscribers)
      return
    // Snapshot to a local array first,
    // so a one-shot subscriber that unsubscribes mid-dispatch,
    // does not mutate the set we are iterating.
    for (const listener of [...subscribers]) {
      listener(event)
    }
  }

  subscribe(workspaceId: WorkspaceId, listener: WorkspaceEventListener): () => void {
    let bucket = this.listeners.get(workspaceId)
    if (!bucket) {
      bucket = new Set()
      this.listeners.set(workspaceId, bucket)
    }
    bucket.add(listener)
    return () => {
      bucket!.delete(listener)
      if (bucket!.size === 0)
        this.listeners.delete(workspaceId)
    }
  }
}
