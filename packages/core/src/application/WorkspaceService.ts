import type { AbsolutePath } from '@telos/schema'
import type { Workspace } from '../domain/workspace/Workspace.js'
import type { WorkspaceRepository } from '../domain/workspace/WorkspaceRepository.js'

export interface WorkspaceServiceDeps {
  workspaceRepository: WorkspaceRepository
}

export class WorkspaceService {
  constructor(private readonly deps: WorkspaceServiceDeps) {}

  async load(rootPath: AbsolutePath): Promise<Workspace> {
    return this.deps.workspaceRepository.load(rootPath)
  }

  async save(workspace: Workspace): Promise<void> {
    return this.deps.workspaceRepository.save(workspace)
  }
}
