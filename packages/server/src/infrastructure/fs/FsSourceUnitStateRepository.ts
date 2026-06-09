import type { SourceUnitStateRepository } from '@braidhq/core'
import type { AbsolutePath, SourceId, SourceUnitState, WorkspaceId } from '@braidhq/schema'
import type { Dirent } from 'node:fs'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { NotFoundError } from '@braidhq/core'
import { SourceUnitState as SourceUnitStateSchema } from '@braidhq/schema'
import { sourceUnitStateDir, sourceUnitStateFilePath, sourceUnitStateSourceDir } from './paths.js'

export interface FsSourceUnitStateRepositoryOptions {
  /**
   * Lookup of `workspaceId → workspaceRoot`. Shared with the other Fs
   * repositories so this repo doesn't introduce a separate dependency
   * on `WorkspaceService`. `composeFs.ts` builds a single closure once
   * and passes it to every fs repo.
   */
  readonly workspaceRoots: () => Promise<ReadonlyMap<WorkspaceId, AbsolutePath>>
}

/**
 * Filesystem-backed `SourceUnitStateRepository`. One JSON file per
 * entity at `artifacts/source-unit-state/<sourceId>/<encoded-path>.json`,
 * matching the file-per-entity pattern used by proposals / clarify.
 *
 * The file body is exactly the `SourceUnitState` shape; no wrapper or
 * envelope. A future SQLite or Postgres impl maps each file to one row
 * with composite PK `(workspaceId, sourceId, path)`.
 */
export class FsSourceUnitStateRepository implements SourceUnitStateRepository {
  constructor(private readonly options: FsSourceUnitStateRepositoryOptions) {}

  async find(workspaceId: WorkspaceId, sourceId: SourceId, path: string): Promise<SourceUnitState | null> {
    const root = await this.resolveRoot(workspaceId)
    const file = sourceUnitStateFilePath(root, sourceId, path)
    try {
      const raw = await readFile(file, 'utf-8')
      return SourceUnitStateSchema.parse(JSON.parse(raw))
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return null
      throw error
    }
  }

  async save(state: SourceUnitState): Promise<void> {
    const root = await this.resolveRoot(state.workspaceId)
    const file = sourceUnitStateFilePath(root, state.sourceId, state.path)
    await mkdir(sourceUnitStateSourceDir(root, state.sourceId), { recursive: true })
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
    await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf-8')
    await rename(tmp, file)
  }

  async listByWorkspace(workspaceId: WorkspaceId): Promise<readonly SourceUnitState[]> {
    const root = await this.resolveRoot(workspaceId)
    const baseDir = sourceUnitStateDir(root)
    const sourceDirs = await safeReaddir(baseDir)
    const all: SourceUnitState[] = []
    for (const sourceDir of sourceDirs) {
      if (!sourceDir.isDirectory())
        continue
      all.push(...await readEntriesIn(join(baseDir, sourceDir.name)))
    }
    return all
  }

  async listBySource(workspaceId: WorkspaceId, sourceId: SourceId): Promise<readonly SourceUnitState[]> {
    const root = await this.resolveRoot(workspaceId)
    return readEntriesIn(sourceUnitStateSourceDir(root, sourceId))
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

async function readEntriesIn(dir: string): Promise<SourceUnitState[]> {
  const entries = await safeReaddir(dir)
  const results: SourceUnitState[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json'))
      continue
    const raw = await readFile(join(dir, entry.name), 'utf-8')
    results.push(SourceUnitStateSchema.parse(JSON.parse(raw)))
  }
  return results
}
