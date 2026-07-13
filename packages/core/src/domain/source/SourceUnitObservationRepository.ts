import type { SourceId, SourceUnitObservation, WorkspaceId } from '@braidhq/schema'

/**
 * Repository port for `SourceUnitObservation`.
 * CRUD shape matching the existing `ProposalRepository` / `ClarifyTicketRepository` pattern,
 * so a SQL-backed implementation can swap in without touching the domain.
 *
 * Identity is the composite `(workspaceId, sourceId, path)`.
 * No delete: orphaned states stay in the store as audit trace, pruning is deferred to a future GC step.
 */
export interface SourceUnitObservationRepository {
  find: (
    workspaceId: WorkspaceId,
    sourceId: SourceId,
    path: string,
  ) => Promise<SourceUnitObservation | null>

  save: (state: SourceUnitObservation) => Promise<void>

  listByWorkspace: (workspaceId: WorkspaceId) => Promise<readonly SourceUnitObservation[]>

  listBySource: (
    workspaceId: WorkspaceId,
    sourceId: SourceId,
  ) => Promise<readonly SourceUnitObservation[]>
}
