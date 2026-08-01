import type { GraphOperation, ModelSnapshot } from '@braidhq/schema'
import type { WorkspaceHistory } from '../domain/history/WorkspaceHistory.js'
import type { ModelRepository } from '../domain/model/ModelRepository.js'
import type { ModelSerializer } from '../domain/model/ModelSerializer.js'
import type { Workspace } from '../domain/workspace/Workspace.js'

export interface WorkspaceBootstrapServiceDeps {
  readonly history: WorkspaceHistory
  readonly serializer: ModelSerializer
  readonly modelRepository: ModelRepository
}

export class WorkspaceBootstrapService {
  constructor(private readonly deps: WorkspaceBootstrapServiceDeps) {}

  /**
   * Idempotent. Runs git init,
   * then reconciles the graph store against `model.json` when they disagree.
   */
  async ensure(workspace: Workspace): Promise<void> {
    await this.deps.history.ensureInitialised(workspace)
    await this.reconcileStoreWithFile(workspace)
  }

  /** Hard reset, used by restore after the working tree just rolled back. */
  async reloadStoreFromFile(workspace: Workspace): Promise<void> {
    const fileSnapshot = await this.deps.serializer.read(workspace)
    await this.wipeStore(workspace)
    if (fileSnapshot)
      await this.hydrateStore(workspace, fileSnapshot)
  }

  // The graph store (`ModelRepository`) is the live queryable copy,
  // `model.json` (`ModelSerializer`) is the git-tracked snapshot on disk.
  // Whichever side is populated seeds the empty side.
  private async reconcileStoreWithFile(workspace: Workspace): Promise<void> {
    const storeSnapshot = await this.deps.modelRepository.load(workspace.id)
    const fileSnapshot = await this.deps.serializer.read(workspace)

    if (storeSnapshot.nodes.length === 0 && fileSnapshot && fileSnapshot.nodes.length > 0) {
      await this.hydrateStore(workspace, fileSnapshot)
      return
    }
    if (storeSnapshot.nodes.length > 0 && !fileSnapshot) {
      await this.deps.serializer.write(workspace, storeSnapshot)
    }
  }

  private async hydrateStore(workspace: Workspace, snapshot: ModelSnapshot): Promise<void> {
    const operations: GraphOperation[] = []
    if (snapshot.nodes.length > 0)
      operations.push({ operation: 'addNodes', payloads: [...snapshot.nodes] })
    if (snapshot.edges.length > 0)
      operations.push({ operation: 'addEdges', payloads: [...snapshot.edges] })
    if (operations.length === 0)
      return
    await this.deps.modelRepository.applyOperations(workspace.id, operations)
  }

  private async wipeStore(workspace: Workspace): Promise<void> {
    const storeSnapshot = await this.deps.modelRepository.load(workspace.id)
    const operations: GraphOperation[] = []
    // Edges first so a store with foreign-key constraints doesn't fight us mid-wipe.
    if (storeSnapshot.edges.length > 0)
      operations.push({ operation: 'removeEdges', edgeIds: storeSnapshot.edges.map(edge => edge.id) })
    if (storeSnapshot.nodes.length > 0)
      operations.push({ operation: 'removeNodes', nodeIds: storeSnapshot.nodes.map(node => node.id) })
    if (operations.length === 0)
      return
    await this.deps.modelRepository.applyOperations(workspace.id, operations)
  }
}
