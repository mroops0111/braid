import type { GraphOperation, ModelSnapshot } from '@braidhq/schema'
import type { WorkspaceHistory } from '../domain/history/WorkspaceHistory.js'
import type { GraphSerializer } from '../domain/model/GraphSerializer.js'
import type { ModelRepository } from '../domain/model/ModelRepository.js'
import type { Workspace } from '../domain/workspace/Workspace.js'

export interface WorkspaceBootstrapDeps {
  readonly history: WorkspaceHistory
  readonly serializer: GraphSerializer
  readonly modelRepository: ModelRepository
}

/**
 * Reconciles a workspace's on-disk state with its in-process caches
 * so the rest of the server can treat any workspace as ready to use.
 *
 * Two invariants are enforced on every `ensure` call:
 *
 * 1. The workspace root is a git repository with an initial commit.
 *    `WorkspaceHistory.ensureInitialised` is idempotent; existing
 *    repos pass through untouched.
 * 2. The persisted `graph.json` and the storage backend (Kùzu today)
 *    agree. When they disagree, the side that has data wins:
 *
 *    - Backend empty + graph.json populated → bulk-load the backend.
 *      Covers the "user restored to an older commit" and "fresh
 *      install pulled a committed workspace from git" cases.
 *    - Backend populated + graph.json missing → dump the backend
 *      to disk so subsequent commits have something to track.
 *      Covers the "existing pre-history workspace getting migrated"
 *      case during the rollout of Phase 1.
 *
 * If both sides agree (both empty, or both populated), no work
 * happens. Callers don't need to track migration state — each
 * `ensure` call inspects the disk and converges.
 */
export class WorkspaceBootstrap {
  constructor(private readonly deps: WorkspaceBootstrapDeps) {}

  async ensure(workspace: Workspace): Promise<void> {
    await this.deps.history.ensureInitialised(workspace)
    await this.reconcileModelWithDisk(workspace)
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
}
