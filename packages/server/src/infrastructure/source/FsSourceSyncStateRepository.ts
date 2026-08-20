import type { SourceSyncStateRepository } from '@braidhq/core'
import type { AbsolutePath, SourceId, SourceSyncState, WorkspaceId } from '@braidhq/schema'
import type { Dirent } from 'node:fs'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { NotFoundError } from '@braidhq/core'
import { SourceSyncState as SourceSyncStateSchema } from '@braidhq/schema'
import { sourceSyncStateDir, sourceSyncStateFilePath } from '../_shared/paths.js'

export interface FsSourceSyncStateRepositoryOptions {
  /** Shared `workspaceId` to `workspaceRoot` lookup, built once by `composeFsApp`. */
  readonly workspaceRoots: () => Promise<ReadonlyMap<WorkspaceId, AbsolutePath>>
}

/**
 * Filesystem-backed `SourceSyncStateRepository`, one file per source at
 * `artifacts/source-sync-state/<sourceId>.json`, matching the file-per-entity
 * pattern the proposal and observation stores already use.
 *
 * Writes go through a temp file and a rename, so a crash mid-write leaves the
 * previous record intact rather than a truncated one the next boot cannot parse.
 */
export class FsSourceSyncStateRepository implements SourceSyncStateRepository {
  constructor(private readonly options: FsSourceSyncStateRepositoryOptions) {}

  async find(workspaceId: WorkspaceId, sourceId: SourceId): Promise<SourceSyncState | null> {
    const root = await this.resolveRoot(workspaceId)
    try {
      const raw = await readFile(sourceSyncStateFilePath(root, sourceId), 'utf-8')
      return SourceSyncStateSchema.parse(JSON.parse(raw))
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return null
      throw error
    }
  }

  async save(state: SourceSyncState): Promise<void> {
    const root = await this.resolveRoot(state.workspaceId)
    const file = sourceSyncStateFilePath(root, state.sourceId)
    await mkdir(sourceSyncStateDir(root), { recursive: true })
    const temporaryPath = `${file}.tmp-${process.pid}-${Date.now()}`
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf-8')
    await rename(temporaryPath, file)
  }

  async listByWorkspace(workspaceId: WorkspaceId): Promise<readonly SourceSyncState[]> {
    const root = await this.resolveRoot(workspaceId)
    const dir = sourceSyncStateDir(root)
    const states: SourceSyncState[] = []
    for (const entry of await safeReaddir(dir)) {
      if (!entry.isFile() || !entry.name.endsWith('.json'))
        continue
      const raw = await readFile(join(dir, entry.name), 'utf-8')
      states.push(SourceSyncStateSchema.parse(JSON.parse(raw)))
    }
    return states
  }

  private async resolveRoot(workspaceId: WorkspaceId): Promise<AbsolutePath> {
    const roots = await this.options.workspaceRoots()
    const root = roots.get(workspaceId)
    if (!root)
      throw new NotFoundError(`Workspace "${workspaceId}" has no registered root path`)
    return root
  }
}

async function safeReaddir(dir: string): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true })
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return []
    throw error
  }
}
