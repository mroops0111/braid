import type { WorkspaceId } from '@braidhq/schema'
import type { WorkspaceEvent } from '../domain/events/WorkspaceEvent.js'

export type WorkspaceEventListener = (event: WorkspaceEvent) => void

/**
 * Process-local pub/sub of `WorkspaceEvent`s. Implementations fan out
 * publishes synchronously to all subscribers of the matching workspace
 * (matching by `event.workspaceId`). The Studio subscribes via a single
 * SSE per workspace; backend services publish into the same bus
 * instance after every state mutation that downstream views care about.
 *
 * Not persistent: events that arrive while no one is subscribed are
 * dropped. The Studio reconciles by re-fetching list endpoints on
 * `EventSource` open.
 */
export interface WorkspaceEventBus {
  /** Fan out an event to every subscriber whose workspaceId matches. */
  publish: (event: WorkspaceEvent) => void
  /**
   * Subscribe to events for a single workspace. Returns an unsubscribe
   * function the caller MUST invoke to free the listener slot (the bus
   * holds it by strong reference).
   */
  subscribe: (workspaceId: WorkspaceId, listener: WorkspaceEventListener) => () => void
}
