import type { SourceId, SourceSyncState, WorkspaceId } from '@braidhq/schema'
import type { SourceSyncStateRepository } from '../../domain/source/SourceSyncStateRepository.js'

function key(workspaceId: WorkspaceId, sourceId: SourceId): string {
  return `${workspaceId}::${sourceId}`
}

/**
 * Default `SourceSyncStateRepository` for tests,
 * and the in-memory `composeApp()` wiring.
 */
export class InMemorySourceSyncStateRepository implements SourceSyncStateRepository {
  private readonly store = new Map<string, SourceSyncState>()

  async find(workspaceId: WorkspaceId, sourceId: SourceId): Promise<SourceSyncState | null> {
    return this.store.get(key(workspaceId, sourceId)) ?? null
  }

  async save(state: SourceSyncState): Promise<void> {
    this.store.set(key(state.workspaceId, state.sourceId), state)
  }

  async listByWorkspace(workspaceId: WorkspaceId): Promise<readonly SourceSyncState[]> {
    return [...this.store.values()].filter(state => state.workspaceId === workspaceId)
  }
}
