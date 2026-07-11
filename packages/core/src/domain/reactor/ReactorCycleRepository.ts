import type { ReactorCycle, ReactorCycleId, WorkspaceId } from '@braidhq/schema'

/**
 * Persistence port for `ReactorCycle` records. The reactor service
 * writes a record on every state transition (dispatched → running →
 * completed / throttled), and the REST routes + Studio Activity page
 * read it back to render the timeline.
 *
 * Sorted by `startedAt` descending in `listByWorkspace` so the Activity
 * list always shows the newest pass first. `save` is upsert — same
 * pass id written multiple times overwrites in place; the reactor
 * relies on this to record per-unit progress without juggling
 * read-modify-write at the call site.
 */
export interface ReactorCycleRepository {
  save: (pass: ReactorCycle) => Promise<void>
  load: (workspaceId: WorkspaceId, passId: ReactorCycleId) => Promise<ReactorCycle | undefined>
  listByWorkspace: (workspaceId: WorkspaceId) => Promise<readonly ReactorCycle[]>
}
