import type { SourceId, SourceUnitState, WorkspaceId } from '@braidhq/schema'
import type { SourceUnitStateRepository } from '../../domain/source/SourceUnitStateRepository.js'

function key(workspaceId: WorkspaceId, sourceId: SourceId, path: string): string {
  return `${workspaceId}::${sourceId}::${path}`
}

/**
 * Default `SourceUnitStateRepository` for tests and the in-memory
 * `composeApp()` wiring. Composite-key lookup by
 * `(workspaceId, sourceId, path)`.
 */
export class InMemorySourceUnitStateRepository implements SourceUnitStateRepository {
  private readonly store = new Map<string, SourceUnitState>()

  async find(workspaceId: WorkspaceId, sourceId: SourceId, path: string): Promise<SourceUnitState | null> {
    return this.store.get(key(workspaceId, sourceId, path)) ?? null
  }

  async save(state: SourceUnitState): Promise<void> {
    this.store.set(key(state.workspaceId, state.sourceId, state.path), state)
  }

  async listByWorkspace(workspaceId: WorkspaceId): Promise<readonly SourceUnitState[]> {
    return [...this.store.values()].filter(s => s.workspaceId === workspaceId)
  }

  async listBySource(workspaceId: WorkspaceId, sourceId: SourceId): Promise<readonly SourceUnitState[]> {
    return [...this.store.values()].filter(s => s.workspaceId === workspaceId && s.sourceId === sourceId)
  }
}
