import type { NodeEmbedding, NodeId, WorkspaceId } from '@braidhq/schema'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { FsEmbeddingRepository } from '../../../src/infrastructure/embedding/FsEmbeddingRepository.js'

const WORKSPACE = 'ws' as WorkspaceId

function embedding(nodeId: string, vector: number[] = [0.1, 0.2]): NodeEmbedding {
  return {
    nodeId: nodeId as NodeId,
    vector,
    modelId: 'bge-m3:latest',
    sourceHash: 'a'.repeat(64),
    createdAt: '2026-05-21T10:00:00.000Z' as NodeEmbedding['createdAt'],
  }
}

describe('fsEmbeddingRepository', () => {
  let root: string
  let repo: FsEmbeddingRepository

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'braid-embeddings-'))
    repo = new FsEmbeddingRepository({ resolveWorkspaceRoot: async () => root })
  })

  it('answers with nothing before anything was written', async () => {
    expect(await repo.list(WORKSPACE)).toEqual([])
  })

  it('round-trips what it stored', async () => {
    await repo.putMany(WORKSPACE, [embedding('a'), embedding('b')])
    expect((await repo.list(WORKSPACE)).map(entry => entry.nodeId).sort()).toEqual(['a', 'b'])
  })

  it('replaces a node vector rather than keeping both', async () => {
    await repo.putMany(WORKSPACE, [embedding('a', [1, 0])])
    await repo.putMany(WORKSPACE, [embedding('a', [0, 1])])

    const stored = await repo.list(WORKSPACE)
    expect(stored).toHaveLength(1)
    expect(stored[0]!.vector).toEqual([0, 1])
  })

  it('removes only what it was asked to remove', async () => {
    await repo.putMany(WORKSPACE, [embedding('a'), embedding('b')])
    await repo.deleteMany(WORKSPACE, ['a' as NodeId])
    expect((await repo.list(WORKSPACE)).map(entry => entry.nodeId)).toEqual(['b'])
  })

  it('keeps the readable lines when one is corrupt, so a rebuild refills the rest', async () => {
    await repo.putMany(WORKSPACE, [embedding('a'), embedding('b')])
    const path = join(root, '.braid', 'embeddings.jsonl')
    const lines = (await readFile(path, 'utf-8')).trim().split('\n')
    await writeFile(path, `${lines[0]}\n{ not json\n${lines[1]}\n`, 'utf-8')

    expect((await repo.list(WORKSPACE)).map(entry => entry.nodeId).sort()).toEqual(['a', 'b'])
  })

  it('drops a line that no longer matches the schema, rather than failing the read', async () => {
    const path = join(root, '.braid', 'embeddings.jsonl')
    await mkdir(join(root, '.braid'), { recursive: true })
    await writeFile(path, `${JSON.stringify({ nodeId: 'a', vector: [] })}\n`, 'utf-8')

    expect(await repo.list(WORKSPACE)).toEqual([])
  })

  it('writes nothing on an empty put, so an idle rebuild leaves the file alone', async () => {
    await repo.putMany(WORKSPACE, [embedding('a')])
    const before = await readFile(join(root, '.braid', 'embeddings.jsonl'), 'utf-8')

    await repo.putMany(WORKSPACE, [])

    expect(await readFile(join(root, '.braid', 'embeddings.jsonl'), 'utf-8')).toBe(before)
  })

  it('lands under .braid, which the workspace gitignore already covers', async () => {
    await repo.putMany(WORKSPACE, [embedding('a')])
    await expect(readFile(join(root, '.braid', 'embeddings.jsonl'), 'utf-8')).resolves.toContain('"nodeId":"a"')
  })
})
