import type { SourceUnitDigest, Workspace } from '@braidhq/core'
import type { SourceId, SourceUnitSha } from '@braidhq/schema'
import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'

/**
 * Filesystem-backed `SourceUnitDigest`. Resolves the unit's relative path,
 * under its filesystem source root, then hashes.
 *
 * - regular file: the sha256 of the file bytes.
 * - directory: a recursive walk hashes each file by content,
 *   assembles a deterministic `<relpath>:<filehash>\n` manifest,
 *   sorted by relpath, then returns the sha256 of that manifest.
 *   Dot-prefixed entries are skipped, per the intent scanner's convention.
 *
 * The intent scanner's trailing-slash convention is accepted,
 * so a file reads as `foo.md` and a folder as `foo/`.
 */
export class FsSourceUnitDigest implements SourceUnitDigest {
  async computeSha(workspace: Workspace, sourceId: SourceId, path: string): Promise<SourceUnitSha> {
    const source = workspace.sources.find(s => s.id === sourceId)
    if (!source || source.kind !== 'filesystem') {
      throw new Error(
        `Cannot compute digest for non-filesystem source "${sourceId}" on workspace "${workspace.id}"`,
      )
    }
    const sourceRoot = isAbsolute(source.path) ? source.path : join(workspace.rootPath, source.path)
    const stripped = path.endsWith('/') ? path.slice(0, -1) : path
    const target = join(sourceRoot, stripped)
    const info = await stat(target)
    if (info.isDirectory())
      return hashDirectory(target) as Promise<SourceUnitSha>
    return hashFile(target) as Promise<SourceUnitSha>
  }
}

async function hashFile(filePath: string): Promise<string> {
  const buf = await readFile(filePath)
  return createHash('sha256').update(buf).digest('hex')
}

async function hashDirectory(dirPath: string): Promise<string> {
  const files: Array<{ rel: string, hash: string }> = []
  await walk(dirPath, dirPath, files)
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  const manifest = files.map(f => `${f.rel}:${f.hash}`).join('\n')
  return createHash('sha256').update(manifest).digest('hex')
}

async function walk(root: string, dir: string, out: Array<{ rel: string, hash: string }>): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.'))
      continue
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(root, abs, out)
      continue
    }
    if (!entry.isFile())
      continue
    out.push({ rel: relative(root, abs), hash: await hashFile(abs) })
  }
}
