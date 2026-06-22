import type { SourceId, WorkspaceId } from '@braidhq/schema'

/**
 * Reactor port. Implementations subscribe to `WorkspaceEventBus` and,
 * on each qualifying `source.synced`, run the active ontology's
 * per-unit skill against new / changed units of the synced source plus
 * one checkpoint pass over the resulting graph.
 *
 * The reactor is intent-driven: it only reacts to `source.synced` whose
 * source has `role: 'intent'`. Code-source syncs fall through because
 * per-unit skills consume intent units (issues / PRDs); re-running them
 * because code beneath them changed yields non-deterministic LLM noise
 * and no semantic gain. Workspaces whose intent stream is sparse should
 * lean on an intent-shaped loader (e.g. PR descriptions, see #61)
 * rather than asking the reactor to learn code-diff semantics.
 *
 * `start` returns a `disposed` handle the composition root keeps for
 * the workspace's lifetime; calling `dispose` detaches the event-bus
 * subscription and drops any in-flight per-unit dispatch (the running
 * SkillRunner subprocess is left alone, on the same theory as Studio's
 * cancel: the user can re-enable later).
 */
export interface Reactor {
  /**
   * Begin reacting to `source.synced` for `workspaceId`. Implementations
   * MUST be idempotent: calling `start` twice for the same workspace
   * returns the same subscription handle without registering a second
   * listener.
   */
  start: (workspaceId: WorkspaceId) => Promise<ReactorSubscription>
  /**
   * Drop any subscription previously created via `start` for this
   * workspace. No-op if `start` was never called.
   */
  stop: (workspaceId: WorkspaceId) => Promise<void>
}

export interface ReactorSubscription {
  readonly workspaceId: WorkspaceId
  /** Detach the event-bus listener; idempotent. */
  readonly dispose: () => Promise<void>
}

/**
 * Snapshot the reactor emits to subscribers when it starts a pass.
 * Carries enough information for the Studio banner to render progress
 * without consulting any other endpoint.
 */
export interface ReactorPassPlan {
  readonly workspaceId: WorkspaceId
  readonly sourceId: SourceId
  /** Unit paths in `new ∪ changed`, in dispatch order. */
  readonly units: readonly string[]
}
