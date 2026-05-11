import type { AbsolutePath } from '@telos/schema'
import { NotFoundError, type Workspace, type WorkspaceRepository } from '../../src/index.js'

export class InMemoryWorkspaceRepository implements WorkspaceRepository {
  private workspaces = new Map<AbsolutePath, Workspace>()

  async load(rootPath: AbsolutePath): Promise<Workspace> {
    const workspace = this.workspaces.get(rootPath)
    if (!workspace)
      throw new NotFoundError(`Workspace at "${rootPath}" not loaded`)
    return workspace
  }

  async save(workspace: Workspace): Promise<void> {
    this.workspaces.set(workspace.rootPath, workspace)
  }
}
