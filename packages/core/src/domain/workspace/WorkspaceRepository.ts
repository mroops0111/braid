import type { AbsolutePath } from '@telos/schema'
import type { Workspace } from './Workspace.js'

export interface WorkspaceRepository {
  list: () => Promise<Workspace[]>
  load: (rootPath: AbsolutePath) => Promise<Workspace>
  save: (workspace: Workspace) => Promise<void>
}
