import type { AbsolutePath } from '@braidhq/schema'
import type { Workspace } from './Workspace.js'

export interface WorkspaceRepository {
  list: () => Promise<Workspace[]>
  load: (rootPath: AbsolutePath) => Promise<Workspace>
  save: (workspace: Workspace) => Promise<void>
  /** Unregister a workspace from this repository. Does not touch the filesystem. */
  remove: (rootPath: AbsolutePath) => Promise<void>
  /** Drop any cached parse of a workspace so the next `load` re-reads from disk. */
  invalidate?: (rootPath: AbsolutePath) => void
}
