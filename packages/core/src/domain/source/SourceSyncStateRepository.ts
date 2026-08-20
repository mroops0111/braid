import type { SourceId, SourceSyncState, WorkspaceId } from '@braidhq/schema'

/**
 * Repository port for `SourceSyncState`, keyed by `(workspaceId, sourceId)`.
 * Matching the `SourceUnitObservationRepository` shape, so a SQL-backed
 * implementation swaps in without the domain noticing.
 *
 * `find` returns null for a source that has never been attempted,
 * which callers read as "not fresh" rather than seeding a record eagerly.
 */
export interface SourceSyncStateRepository {
  find: (workspaceId: WorkspaceId, sourceId: SourceId) => Promise<SourceSyncState | null>

  save: (state: SourceSyncState) => Promise<void>

  listByWorkspace: (workspaceId: WorkspaceId) => Promise<readonly SourceSyncState[]>
}
