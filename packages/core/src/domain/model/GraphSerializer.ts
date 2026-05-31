import type { ModelSnapshot } from '@braidhq/schema'
import type { Workspace } from '../workspace/Workspace.js'

export interface GraphSerializer {
  write: (workspace: Workspace, snapshot: ModelSnapshot) => Promise<void>
  /** Returns null when the file doesn't exist; throws on malformed contents. */
  read: (workspace: Workspace) => Promise<ModelSnapshot | null>
  exists: (workspace: Workspace) => Promise<boolean>
}
