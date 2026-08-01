import type { WorkspaceEvent, WorkspaceId } from '@braidhq/schema'

export type WorkspaceEventListener = (event: WorkspaceEvent) => void

/**
 * Process-local pub/sub of `WorkspaceEvent`s.
 * Each publish fans out synchronously to every subscriber of that workspace,
 * matched by `event.workspaceId`.
 * The Studio subscribes via a single SSE per workspace.
 * Backend services publish into the same bus instance,
 * after every state mutation that downstream views care about.
 *
 * Not persistent: events that arrive while no one is subscribed are dropped.
 * The Studio reconciles by re-fetching list endpoints on `EventSource` open.
 */
export interface WorkspaceEventBus {
  /** Fan out an event to every subscriber whose workspaceId matches. */
  publish: (event: WorkspaceEvent) => void
  /**
   * Subscribe to events for a single workspace.
   * Returns an unsubscribe function the caller MUST invoke to free the slot,
   * the bus holds it by strong reference.
   */
  subscribe: (workspaceId: WorkspaceId, listener: WorkspaceEventListener) => () => void
}
