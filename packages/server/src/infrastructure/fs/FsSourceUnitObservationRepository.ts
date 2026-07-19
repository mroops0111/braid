import type { SourceUnitObservationRepository } from '@braidhq/core'
import type { AbsolutePath, SourceId, SourceUnitObservation, WorkspaceId } from '@braidhq/schema'
import type { Dirent } from 'node:fs'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { NotFoundError } from '@braidhq/core'
import { SourceUnitObservation as SourceUnitObservationSchema } from '@braidhq/schema'
import { sourceUnitObservationDir, sourceUnitObservationFilePath, sourceUnitObservationSourceDir } from './paths.js'

export interface FsSourceUnitObservationRepositoryOptions {
  /**
   * Lookup of `workspaceId` to `workspaceRoot`, shared by the repos,
   * so this one takes no `WorkspaceService` dependency of its own.
   * `composeFs.ts` builds the closure once, then hands the same one,
   * to every fs repo.
   */
  readonly workspaceRoots: () => Promise<ReadonlyMap<WorkspaceId, AbsolutePath>>
}

/**
 * Filesystem-backed `SourceUnitObservationRepository`. Each entity maps to,
 * `artifacts/source-unit-state/<sourceId>/<encoded-path>.json`, one file each,
 * matching the file-per-entity pattern used by proposals / clarifications.
 *
 * The file body is exactly the `SourceUnitObservation` shape,
 * with no wrapper or envelope.
 * In a future SQLite or Postgres store,
 * each file becomes one row keyed by `(workspaceId, sourceId, path)`.
 */
export class FsSourceUnitObservationRepository implements SourceUnitObservationRepository {
  constructor(private readonly options: FsSourceUnitObservationRepositoryOptions) {}

  async find(workspaceId: WorkspaceId, sourceId: SourceId, path: string): Promise<SourceUnitObservation | null> {
    const root = await this.resolveRoot(workspaceId)
    const file = sourceUnitObservationFilePath(root, sourceId, path)
    try {
      const raw = await readFile(file, 'utf-8')
      return SourceUnitObservationSchema.parse(JSON.parse(raw))
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return null
      throw error
    }
  }

  async save(state: SourceUnitObservation): Promise<void> {
    const root = await this.resolveRoot(state.workspaceId)
    const file = sourceUnitObservationFilePath(root, state.sourceId, state.path)
    await mkdir(sourceUnitObservationSourceDir(root, state.sourceId), { recursive: true })
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
    await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf-8')
    await rename(tmp, file)
  }

  async listByWorkspace(workspaceId: WorkspaceId): Promise<readonly SourceUnitObservation[]> {
    const root = await this.resolveRoot(workspaceId)
    const baseDir = sourceUnitObservationDir(root)
    const sourceDirs = await safeReaddir(baseDir)
    const all: SourceUnitObservation[] = []
    for (const sourceDir of sourceDirs) {
      if (!sourceDir.isDirectory())
        continue
      all.push(...await readEntriesIn(join(baseDir, sourceDir.name)))
    }
    return all
  }

  async listBySource(workspaceId: WorkspaceId, sourceId: SourceId): Promise<readonly SourceUnitObservation[]> {
    const root = await this.resolveRoot(workspaceId)
    return readEntriesIn(sourceUnitObservationSourceDir(root, sourceId))
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

async function readEntriesIn(dir: string): Promise<SourceUnitObservation[]> {
  const entries = await safeReaddir(dir)
  const results: SourceUnitObservation[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json'))
      continue
    const raw = await readFile(join(dir, entry.name), 'utf-8')
    results.push(SourceUnitObservationSchema.parse(JSON.parse(raw)))
  }
  return results
}
