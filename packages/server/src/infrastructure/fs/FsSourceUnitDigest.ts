import type { SourceUnitDigest, Workspace } from '@braidhq/core'
import type { SourceId, SourceUnitSha } from '@braidhq/schema'
import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'

/**
 * Filesystem-backed `SourceUnitDigest`. Resolves the unit's relative
 * path under its filesystem source root, then either:
 *
 * - regular file: sha256 of file bytes
 * - directory: recursive walk; hash each file by content; build a
 *   deterministic `<relpath>:<filehash>\n` manifest sorted by relpath;
 *   sha256 the manifest. Dot-prefixed entries are skipped (mirrors the
 *   intent scanner's convention).
 *
 * Trailing-slash convention from the intent scanner (file = `foo.md`,
 * folder = `foo/`) is accepted.
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
