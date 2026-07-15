import type { SourceId, WorkspaceId } from '@braidhq/schema'

/**
 * Reactor port. Implementations subscribe to `WorkspaceEventBus` and, on each qualifying `source.synced`,
 * run the active ontology's per-unit skill against new / changed units of the synced source,
 * plus one checkpoint pass over the resulting model.
 *
 * The reactor is intent-driven: it only reacts to `source.synced` whose source has `role: 'intent'`.
 * Code-source syncs fall through because per-unit skills consume intent units (issues / PRDs),
 * re-running them because code beneath them changed yields non-deterministic LLM noise and no semantic gain.
 * Workspaces whose intent stream is sparse should lean on an intent-shaped loader (e.g. PR descriptions,
 * see #61) rather than asking the reactor to learn code-diff semantics.
 *
 * Lifecycle is per workspace: `start` attaches a subscription, `stop` detaches it.
 * Both are idempotent: calling `start` twice for the same workspace is a no-op,
 * same for `stop` on a workspace that was never started. There is no separate subscription handle,
 * callers just remember the workspace id they passed to `start`.
 */
export interface Reactor {
  /** Begin reacting to `source.synced` for `workspaceId`. Idempotent. */
  start: (workspaceId: WorkspaceId) => Promise<void>
  /** Detach the listener for `workspaceId`. Idempotent. */
  stop: (workspaceId: WorkspaceId) => Promise<void>
}

/**
 * Snapshot the reactor emits to subscribers when it starts a pass.
 * Carries enough information for the Studio banner to render progress without consulting any other endpoint.
 */
export interface ReactorCyclePlan {
  readonly workspaceId: WorkspaceId
  readonly sourceId: SourceId
  /** Unit paths in `new ∪ changed`, in dispatch order. */
  readonly units: readonly string[]
}
