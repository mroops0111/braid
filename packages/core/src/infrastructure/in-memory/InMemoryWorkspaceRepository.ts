import type { AbsolutePath } from '@telos/schema'
import type { Workspace } from '../../domain/workspace/Workspace.js'
import type { WorkspaceRepository } from '../../domain/workspace/WorkspaceRepository.js'
import { InMemoryKeyedStore } from './InMemoryKeyedStore.js'

export class InMemoryWorkspaceRepository implements WorkspaceRepository {
  private readonly store = new InMemoryKeyedStore<AbsolutePath, Workspace>('Workspace')

  async list(): Promise<Workspace[]> {
    return this.store.listAll()
  }

  async load(rootPath: AbsolutePath): Promise<Workspace> {
    return this.store.get(rootPath)
  }

  async save(workspace: Workspace): Promise<void> {
    this.store.set(workspace.rootPath, workspace)
  }
}
