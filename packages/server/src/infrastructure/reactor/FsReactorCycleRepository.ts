import type { ReactorCycleRepository } from '@braidhq/core'
import type { AbsolutePath, ReactorCycle, ReactorCycleId, WorkspaceId } from '@braidhq/schema'
import type { Dirent } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { NotFoundError } from '@braidhq/core'
import { ReactorCycle as ReactorCycleSchema } from '@braidhq/schema'
import { reactorCycleFilePath, reactorCyclesDir } from '../_shared/paths.js'

export interface FsReactorCycleRepositoryOptions {
  /**
   * Lookup of workspaceId to workspaceRoot. Shared with the other Fs repositories,
   * so this repo doesn't introduce a separate dependency on `WorkspaceService`.
   * `composeFs.ts` builds a single closure once and passes it to every fs repo.
   */
  readonly workspaceRoots: () => Promise<ReadonlyMap<WorkspaceId, AbsolutePath>>
}

/**
 * Filesystem-backed `ReactorCycleRepository`. One JSON file per cycle,
 * at `artifacts/reactor-cycles/<cycleId>.json`.
 * Each save is an atomic rename,
 * so the Studio Activity page never reads a half-written file.
 *
 * The file body is exactly the `ReactorCycle` shape, no wrapper or envelope.
 * A future SQLite or Postgres impl maps one file to one row keyed by `cycleId`,
 * with `(workspaceId, startedAt)` indexed for the list query.
 */
export class FsReactorCycleRepository implements ReactorCycleRepository {
  constructor(private readonly options: FsReactorCycleRepositoryOptions) {}

  async save(cycle: ReactorCycle): Promise<void> {
    const root = await this.resolveRoot(cycle.workspaceId)
    const file = reactorCycleFilePath(root, cycle.id)
    await mkdir(reactorCyclesDir(root), { recursive: true })
    // Random suffix so concurrent saves in the same ms don't collide.
    const tmp = `${file}.tmp-${process.pid}-${randomUUID()}`
    await writeFile(tmp, `${JSON.stringify(cycle, null, 2)}\n`, 'utf-8')
    await rename(tmp, file)
  }

  async load(workspaceId: WorkspaceId, cycleId: ReactorCycleId): Promise<ReactorCycle | undefined> {
    const root = await this.resolveRoot(workspaceId)
    const file = reactorCycleFilePath(root, cycleId)
    try {
      const raw = await readFile(file, 'utf-8')
      const parsed = ReactorCycleSchema.parse(JSON.parse(raw))
      // The directory layout is per-workspace already,
      // but double-check the body matches, guarding the case,
      // where an operator copy-pasted in a file from another workspace.
      if (parsed.workspaceId !== workspaceId)
        return undefined
      return parsed
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return undefined
      throw error
    }
  }

  async listByWorkspace(workspaceId: WorkspaceId): Promise<readonly ReactorCycle[]> {
    const root = await this.resolveRoot(workspaceId)
    const dir = reactorCyclesDir(root)
    const entries = await safeReaddir(dir)
    const cycles: ReactorCycle[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json'))
        continue
      if (entry.name.includes('.tmp-'))
        continue
      const raw = await readFile(join(dir, entry.name), 'utf-8')
      try {
        const parsed = ReactorCycleSchema.parse(JSON.parse(raw))
        if (parsed.workspaceId === workspaceId)
          cycles.push(parsed)
      }
      catch {
        // Skip files that fail validation, truncated half-writes,
        // or manual edits gone wrong.
        // Raising them as errors here would,
        // in turn, block the Activity page from rendering recent cycles.
      }
    }
    return cycles.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
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
