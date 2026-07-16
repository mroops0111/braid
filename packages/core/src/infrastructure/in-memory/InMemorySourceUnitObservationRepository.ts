import type { SourceId, SourceUnitObservation, WorkspaceId } from '@braidhq/schema'
import type { SourceUnitObservationRepository } from '../../domain/source/SourceUnitObservationRepository.js'

function key(workspaceId: WorkspaceId, sourceId: SourceId, path: string): string {
  return `${workspaceId}::${sourceId}::${path}`
}

/**
 * Default `SourceUnitObservationRepository` for tests,
 * and the in-memory `composeApp()` wiring.
 * Composite-key lookup by `(workspaceId, sourceId, path)`.
 */
export class InMemorySourceUnitObservationRepository implements SourceUnitObservationRepository {
  private readonly store = new Map<string, SourceUnitObservation>()

  async find(workspaceId: WorkspaceId, sourceId: SourceId, path: string): Promise<SourceUnitObservation | null> {
    return this.store.get(key(workspaceId, sourceId, path)) ?? null
  }

  async save(state: SourceUnitObservation): Promise<void> {
    this.store.set(key(state.workspaceId, state.sourceId, state.path), state)
  }

  async listByWorkspace(workspaceId: WorkspaceId): Promise<readonly SourceUnitObservation[]> {
    return [...this.store.values()].filter(observation => observation.workspaceId === workspaceId)
  }

  async listBySource(workspaceId: WorkspaceId, sourceId: SourceId): Promise<readonly SourceUnitObservation[]> {
    return [...this.store.values()].filter(observation => observation.workspaceId === workspaceId && observation.sourceId === sourceId)
  }
}
