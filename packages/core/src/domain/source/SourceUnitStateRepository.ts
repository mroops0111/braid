import type { SourceId, SourceUnitState, WorkspaceId } from '@braidhq/schema'

/**
 * Repository port for `SourceUnitState`. CRUD shape matching the
 * existing `ProposalRepository` / `ClarifyTicketRepository` pattern so
 * a SQL-backed implementation can swap in without touching the domain.
 *
 * Identity is the composite `(workspaceId, sourceId, path)`. No
 * delete: orphaned states stay in the store as audit trace; pruning is
 * deferred to a future GC step.
 */
export interface SourceUnitStateRepository {
  find: (
    workspaceId: WorkspaceId,
    sourceId: SourceId,
    path: string,
  ) => Promise<SourceUnitState | null>

  save: (state: SourceUnitState) => Promise<void>

  listByWorkspace: (workspaceId: WorkspaceId) => Promise<readonly SourceUnitState[]>

  listBySource: (
    workspaceId: WorkspaceId,
    sourceId: SourceId,
  ) => Promise<readonly SourceUnitState[]>
}
