import type { ReactorPassRepository } from '@braidhq/core'
import type { AbsolutePath, ReactorPass, ReactorPassId, WorkspaceId } from '@braidhq/schema'
import type { Dirent } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { NotFoundError } from '@braidhq/core'
import { ReactorPass as ReactorPassSchema } from '@braidhq/schema'
import { reactorPassesDir, reactorPassFilePath } from './paths.js'

export interface FsReactorPassRepositoryOptions {
  /**
   * Lookup of `workspaceId → workspaceRoot`. Shared with the other Fs
   * repositories so this repo doesn't introduce a separate dependency
   * on `WorkspaceService`. `composeFs.ts` builds a single closure once
   * and passes it to every fs repo.
   */
  readonly workspaceRoots: () => Promise<ReadonlyMap<WorkspaceId, AbsolutePath>>
}

/**
 * Filesystem-backed `ReactorPassRepository`. One JSON file per pass at
 * `artifacts/reactor-passes/<passId>.json`. Each save is an atomic
 * rename so the Studio Activity page never reads a half-written file
 * while the reactor is mid-pass.
 *
 * The file body is exactly the `ReactorPass` shape; no wrapper, no
 * envelope. Future SQLite/Postgres impls map one file to one row keyed
 * by `passId`, with `(workspaceId, startedAt)` indexed for the list
 * query.
 */
export class FsReactorPassRepository implements ReactorPassRepository {
  constructor(private readonly options: FsReactorPassRepositoryOptions) {}

  async save(pass: ReactorPass): Promise<void> {
    const root = await this.resolveRoot(pass.workspaceId)
    const file = reactorPassFilePath(root, pass.id)
    await mkdir(reactorPassesDir(root), { recursive: true })
    // Random suffix so concurrent saves in the same ms don't collide.
    const tmp = `${file}.tmp-${process.pid}-${randomUUID()}`
    await writeFile(tmp, `${JSON.stringify(pass, null, 2)}\n`, 'utf-8')
    await rename(tmp, file)
  }

  async load(workspaceId: WorkspaceId, passId: ReactorPassId): Promise<ReactorPass | undefined> {
    const root = await this.resolveRoot(workspaceId)
    const file = reactorPassFilePath(root, passId)
    try {
      const raw = await readFile(file, 'utf-8')
      const parsed = ReactorPassSchema.parse(JSON.parse(raw))
      // The directory layout is per-workspace already; double-check the
      // body matches in case a stray file from another workspace was
      // copy-pasted in by an operator.
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

  async listByWorkspace(workspaceId: WorkspaceId): Promise<readonly ReactorPass[]> {
    const root = await this.resolveRoot(workspaceId)
    const dir = reactorPassesDir(root)
    const entries = await safeReaddir(dir)
    const passes: ReactorPass[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json'))
        continue
      if (entry.name.includes('.tmp-'))
        continue
      const raw = await readFile(join(dir, entry.name), 'utf-8')
      try {
        const parsed = ReactorPassSchema.parse(JSON.parse(raw))
        if (parsed.workspaceId === workspaceId)
          passes.push(parsed)
      }
      catch {
        // Skip files that fail validation (truncated half-writes, manual
        // edits gone wrong). Surfacing them as errors in the list call
        // would block the Activity page from rendering recent passes.
      }
    }
    return passes.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
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
