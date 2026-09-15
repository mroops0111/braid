import type { StoredView, ViewRepository, Workspace } from '@braidhq/core'
import type { EmittedBlock, ViewArtifactFile } from '@braidhq/schema'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { EmittedBlock as EmittedBlockSchema } from '@braidhq/schema'
import { z } from 'zod'
import { workspaceArtifactsDir } from '../_shared/paths.js'

const VIEWS_DIR = 'views'

export class FsViewRepository implements ViewRepository {
  async list(workspace: Workspace): Promise<readonly StoredView[]> {
    const root = viewsRoot(workspace)
    const found = await walk(root)
    const views = await Promise.all(found.map(async (path): Promise<StoredView> => {
      const stamped = await stat(path)
      return {
        path: relative(root, path).split(sep).join('/'),
        bytes: stamped.size,
        writtenAt: stamped.mtime.toISOString(),
      }
    }))
    return views.sort((one, other) => one.path.localeCompare(other.path))
  }

  async read(workspace: Workspace, path: string): Promise<readonly EmittedBlock[] | undefined> {
    const resolved = within(viewsRoot(workspace), path)
    if (resolved === undefined)
      return undefined
    const text = await readFile(resolved, 'utf-8').catch(() => undefined)
    if (text === undefined)
      return undefined
    // A file this wrote and cannot now parse is one nobody can draw,
    // so it reads as absent rather than as a document that fails halfway.
    const parsed = z.array(EmittedBlockSchema).safeParse(jsonOr(text))
    return parsed.success ? parsed.data : undefined
  }

  async write(
    workspace: Workspace,
    path: string,
    blocks: readonly EmittedBlock[],
  ): Promise<void> {
    const resolved = within(viewsRoot(workspace), path)
    if (resolved === undefined)
      throw new Error(`A document cannot be written outside the views directory, at "${path}"`)
    await mkdir(dirname(resolved), { recursive: true })
    await writeFile(resolved, `${JSON.stringify(blocks, null, 2)}\n`, 'utf-8')
  }

  async writeMaterial(
    workspace: Workspace,
    files: readonly ViewArtifactFile[],
  ): Promise<readonly string[]> {
    const artifacts = workspaceArtifactsDir(workspace.rootPath)
    return Promise.all(files.map(async (file) => {
      const resolved = within(artifacts, file.path)
      if (resolved === undefined)
        throw new Error(`A generator wrote outside the workspace, at "${file.path}"`)
      await mkdir(dirname(resolved), { recursive: true })
      await writeFile(resolved, file.text, 'utf-8')
      // The skill is handed a path it can resolve against the workspace root,
      // which is the one directory it is told about.
      return join('artifacts', file.path)
    }))
  }

  async readMaterial(workspace: Workspace, path: string): Promise<string | undefined> {
    const resolved = within(workspaceArtifactsDir(workspace.rootPath), path)
    if (resolved === undefined)
      return undefined
    return readFile(resolved, 'utf-8').catch(() => undefined)
  }
}

function jsonOr(text: string): unknown {
  try {
    return JSON.parse(text)
  }
  catch {
    return undefined
  }
}

/**
 * Where the written views are, which is beside the knowledge they are of.
 * Anything that writes one lands here without being told to.
 */
function viewsRoot(workspace: Workspace): string {
  return join(workspaceArtifactsDir(workspace.rootPath), VIEWS_DIR)
}

/**
 * A path a caller asked for, resolved under a root or refused.
 *
 * A path is a string somebody chose,
 * so one that climbs out would read any file it can reach.
 * Resolving first and checking the result,
 * is what makes a name that walks upwards fail rather than escape.
 */
function within(root: string, asked: string): string | undefined {
  const full = join(root, asked)
  const inside = relative(root, full)
  return inside.startsWith('..') || inside.startsWith(sep) ? undefined : full
}

/**
 * Every file under a directory, however deeply it is nested.
 *
 * A name beginning with a dot is passed over.
 * Nothing that writes a view names one that way,
 * so anything found under one belongs to the operating system,
 * and a reader offered it would be offered a file nobody made.
 */
async function walk(root: string, at: string = root): Promise<readonly string[]> {
  const entries = await readdir(at, { withFileTypes: true }).catch(() => [])
  const found = await Promise.all(entries.map(async (entry) => {
    if (entry.name.startsWith('.'))
      return []
    const here = join(at, entry.name)
    return entry.isDirectory() ? walk(root, here) : [here]
  }))
  return found.flat()
}
