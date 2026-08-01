import type { AbsolutePath, SourceId } from '@braidhq/schema'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FsSourceUnitDigest } from '../../../src/infrastructure/source/FsSourceUnitDigest.js'
import { makeWorkspace } from '../../helpers/fakes.js'

async function makeRoot(): Promise<AbsolutePath> {
  return (await mkdtemp(join(tmpdir(), 'braid-source-digest-'))) as AbsolutePath
}

function intentSource(id: string, path: AbsolutePath) {
  return {
    kind: 'filesystem' as const,
    id: id as SourceId,
    role: 'intent' as const,
    name: id,
    path,
  }
}

describe('FsSourceUnitDigest', () => {
  it('hashes a single file by content; identical content yields identical sha', async () => {
    const sourcePath = await makeRoot()
    await writeFile(join(sourcePath, 'a.md'), 'hello braid\n', 'utf-8')
    const ws = makeWorkspace({ rootPath: sourcePath, sources: [intentSource('intent', sourcePath)] })
    const digest = new FsSourceUnitDigest()

    const sha1 = await digest.computeSha(ws, 'intent' as SourceId, 'a.md')
    const sha2 = await digest.computeSha(ws, 'intent' as SourceId, 'a.md')
    expect(sha1).toMatch(/^[a-f0-9]{64}$/)
    expect(sha1).toBe(sha2)
  })

  it('different content yields different sha', async () => {
    const sourcePath = await makeRoot()
    const ws = makeWorkspace({ rootPath: sourcePath, sources: [intentSource('intent', sourcePath)] })
    const digest = new FsSourceUnitDigest()

    await writeFile(join(sourcePath, 'a.md'), 'first\n', 'utf-8')
    const before = await digest.computeSha(ws, 'intent' as SourceId, 'a.md')
    await writeFile(join(sourcePath, 'a.md'), 'second\n', 'utf-8')
    const after = await digest.computeSha(ws, 'intent' as SourceId, 'a.md')
    expect(before).not.toBe(after)
  })

  it('hashes a folder by walking its files; tolerates trailing slash on path', async () => {
    const sourcePath = await makeRoot()
    await mkdir(join(sourcePath, 'feature'), { recursive: true })
    await writeFile(join(sourcePath, 'feature', 'a.md'), 'A\n', 'utf-8')
    await writeFile(join(sourcePath, 'feature', 'b.md'), 'B\n', 'utf-8')

    const ws = makeWorkspace({ rootPath: sourcePath, sources: [intentSource('intent', sourcePath)] })
    const digest = new FsSourceUnitDigest()

    const withSlash = await digest.computeSha(ws, 'intent' as SourceId, 'feature/')
    const withoutSlash = await digest.computeSha(ws, 'intent' as SourceId, 'feature')
    expect(withSlash).toBe(withoutSlash)
    expect(withSlash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('folder sha changes when any file inside changes', async () => {
    const sourcePath = await makeRoot()
    await mkdir(join(sourcePath, 'feature'), { recursive: true })
    await writeFile(join(sourcePath, 'feature', 'a.md'), 'A\n', 'utf-8')
    const ws = makeWorkspace({ rootPath: sourcePath, sources: [intentSource('intent', sourcePath)] })
    const digest = new FsSourceUnitDigest()

    const before = await digest.computeSha(ws, 'intent' as SourceId, 'feature/')
    await writeFile(join(sourcePath, 'feature', 'a.md'), 'A changed\n', 'utf-8')
    const after = await digest.computeSha(ws, 'intent' as SourceId, 'feature/')
    expect(before).not.toBe(after)
  })

  it('throws on non-filesystem source', async () => {
    const ws = makeWorkspace({
      sources: [{
        kind: 'mcp',
        id: 'mcp-src' as SourceId,
        role: 'intent',
        name: 'mcp',
        mcpServerId: 'srv' as never,
      }],
    })
    const digest = new FsSourceUnitDigest()
    await expect(digest.computeSha(ws, 'mcp-src' as SourceId, 'whatever')).rejects.toThrow()
  })
})
