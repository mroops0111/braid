import type { GraphOperation, ModelSnapshot } from '@braidhq/schema'
import type { WorkspaceHistory } from '../domain/history/WorkspaceHistory.js'
import type { ModelRepository } from '../domain/model/ModelRepository.js'
import type { ModelSerializer } from '../domain/model/ModelSerializer.js'
import type { Workspace } from '../domain/workspace/Workspace.js'

export interface WorkspaceBootstrapDeps {
  readonly history: WorkspaceHistory
  readonly serializer: ModelSerializer
  readonly modelRepository: ModelRepository
}

export class WorkspaceBootstrap {
  constructor(private readonly deps: WorkspaceBootstrapDeps) {}

  /**
   * Idempotent. Runs git init,
   * then reconciles model.json against the storage backend when they disagree.
   */
  async ensure(workspace: Workspace): Promise<void> {
    await this.deps.history.ensureInitialised(workspace)
    await this.reconcileModelWithDisk(workspace)
  }

  /** Hard reset, used by restore after the working tree just rolled back. */
  async reloadFromDisk(workspace: Workspace): Promise<void> {
    const persisted = await this.deps.serializer.read(workspace)
    await this.wipeBackend(workspace)
    if (persisted)
      await this.hydrateBackend(workspace, persisted)
  }

  private async reconcileModelWithDisk(workspace: Workspace): Promise<void> {
    const backend = await this.deps.modelRepository.load(workspace.id)
    const persisted = await this.deps.serializer.read(workspace)

    if (backend.nodes.length === 0 && persisted && persisted.nodes.length > 0) {
      await this.hydrateBackend(workspace, persisted)
      return
    }
    if (backend.nodes.length > 0 && !persisted) {
      await this.deps.serializer.write(workspace, backend)
    }
  }

  private async hydrateBackend(workspace: Workspace, snapshot: ModelSnapshot): Promise<void> {
    const operations: GraphOperation[] = []
    if (snapshot.nodes.length > 0)
      operations.push({ operation: 'addNodes', payloads: [...snapshot.nodes] })
    if (snapshot.edges.length > 0)
      operations.push({ operation: 'addEdges', payloads: [...snapshot.edges] })
    if (operations.length === 0)
      return
    await this.deps.modelRepository.applyOperations(workspace.id, operations)
  }

  private async wipeBackend(workspace: Workspace): Promise<void> {
    const existing = await this.deps.modelRepository.load(workspace.id)
    const operations: GraphOperation[] = []
    // Edges first so backends with FK constraints don't fight us mid-wipe.
    if (existing.edges.length > 0)
      operations.push({ operation: 'removeEdges', edgeIds: existing.edges.map(e => e.id) })
    if (existing.nodes.length > 0)
      operations.push({ operation: 'removeNodes', nodeIds: existing.nodes.map(n => n.id) })
    if (operations.length === 0)
      return
    await this.deps.modelRepository.applyOperations(workspace.id, operations)
  }
}
