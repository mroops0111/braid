import type { EmittedBlock, ViewArtifactFile } from '@braidhq/schema'
import type { Workspace } from '../workspace/Workspace.js'

/** One file under the views directory, as the store finds it. */
export interface StoredView {
  /** Path under the views directory, which is also how one is asked for. */
  readonly path: string
  readonly bytes: number
  readonly writtenAt: string
}

/**
 * Where a written view and the material it was written from are kept.
 *
 * A view is written by the run that rendered it,
 * and is derived from the graph rather than authored,
 * so nothing a reader does changes one.
 */
export interface ViewRepository {
  list: (workspace: Workspace) => Promise<readonly StoredView[]>
  /**
   * The blocks at a path under the views directory,
   * or nothing where there is no such view.
   * A path escaping the directory is nothing rather than an error,
   * since a caller chose the string,
   * and neither outcome should read any file it can reach.
   */
  read: (workspace: Workspace, path: string) => Promise<readonly EmittedBlock[] | undefined>
  /** Keep what a run rendered, replacing whatever was there. */
  write: (
    workspace: Workspace,
    path: string,
    blocks: readonly EmittedBlock[],
  ) => Promise<void>
  /** Write a projection, answering with each file's workspace-relative path. */
  writeMaterial: (
    workspace: Workspace,
    files: readonly ViewArtifactFile[],
  ) => Promise<readonly string[]>
  readMaterial: (workspace: Workspace, path: string) => Promise<string | undefined>
}
