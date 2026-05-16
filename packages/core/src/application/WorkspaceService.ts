import type { AbsolutePath, WorkspaceId } from '@braidhq/schema'
import type { Workspace } from '../domain/workspace/Workspace.js'
import type { WorkspaceRepository } from '../domain/workspace/WorkspaceRepository.js'
import { NotFoundError } from '../domain/errors.js'

export interface WorkspaceServiceDeps {
  workspaceRepository: WorkspaceRepository
}

export class WorkspaceService {
  constructor(private readonly deps: WorkspaceServiceDeps) {}

  async list(): Promise<Workspace[]> {
    return this.deps.workspaceRepository.list()
  }

  async load(rootPath: AbsolutePath): Promise<Workspace> {
    return this.deps.workspaceRepository.load(rootPath)
  }

  async save(workspace: Workspace): Promise<void> {
    return this.deps.workspaceRepository.save(workspace)
  }

  async findById(workspaceId: WorkspaceId): Promise<Workspace> {
    const workspaces = await this.deps.workspaceRepository.list()
    const match = workspaces.find(workspace => workspace.id === workspaceId)
    if (!match)
      throw new NotFoundError(`Workspace "${workspaceId}" not registered`)
    return match
  }

  async remove(rootPath: AbsolutePath): Promise<void> {
    return this.deps.workspaceRepository.remove(rootPath)
  }

  /**
   * Discard any cached parse so the next `load` re-reads from disk. Call
   * after rewriting PRODUCT.md so subsequent reads pick up the new manifest.
   */
  invalidate(rootPath: AbsolutePath): void {
    this.deps.workspaceRepository.invalidate?.(rootPath)
  }
}
