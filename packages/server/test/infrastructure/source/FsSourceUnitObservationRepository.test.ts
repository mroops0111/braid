import type { AbsolutePath, SkillRunId, SourceId, SourceUnitObservation, SourceUnitSha, Timestamp, WorkspaceId } from '@braidhq/schema'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FsSourceUnitObservationRepository } from '../../../src/infrastructure/source/FsSourceUnitObservationRepository.js'

async function makeRoot(): Promise<AbsolutePath> {
  return (await mkdtemp(join(tmpdir(), 'braid-source-unit-state-'))) as AbsolutePath
}

function sha(byte: string): SourceUnitSha {
  return byte.repeat(64) as SourceUnitSha
}

function makeState(workspaceId: WorkspaceId, sourceId: string, path: string, hex: string): SourceUnitObservation {
  return {
    workspaceId,
    sourceId: sourceId as SourceId,
    path,
    lastObservedSha: sha(hex),
    lastObservedAt: '2026-06-08T00:00:00.000Z' as Timestamp,
    lastObservedByRunId: 'run-1' as SkillRunId,
  }
}

function workspaceRootsClosure(root: AbsolutePath, workspaceId: WorkspaceId) {
  return async () => new Map([[workspaceId, root]])
}

describe('FsSourceUnitObservationRepository', () => {
  it('find returns null before any write', async () => {
    const root = await makeRoot()
    const wsId = 'ws-1' as WorkspaceId
    const repo = new FsSourceUnitObservationRepository({ workspaceRoots: workspaceRootsClosure(root, wsId) })
    expect(await repo.find(wsId, 'src' as SourceId, 'foo.md')).toBeNull()
  })

  it('save then find round-trips one entry', async () => {
    const root = await makeRoot()
    const wsId = 'ws-1' as WorkspaceId
    const repo = new FsSourceUnitObservationRepository({ workspaceRoots: workspaceRootsClosure(root, wsId) })
    await repo.save(makeState(wsId, 'src', 'foo.md', 'a'))
    const found = await repo.find(wsId, 'src' as SourceId, 'foo.md')
    expect(found?.lastObservedSha).toBe(sha('a'))
  })

  it('save overwrites the existing entry for the same key', async () => {
    const root = await makeRoot()
    const wsId = 'ws-1' as WorkspaceId
    const repo = new FsSourceUnitObservationRepository({ workspaceRoots: workspaceRootsClosure(root, wsId) })
    await repo.save(makeState(wsId, 'src', 'foo.md', 'a'))
    await repo.save(makeState(wsId, 'src', 'foo.md', 'b'))
    const found = await repo.find(wsId, 'src' as SourceId, 'foo.md')
    expect(found?.lastObservedSha).toBe(sha('b'))
  })

  it('listByWorkspace returns all entries across all sources', async () => {
    const root = await makeRoot()
    const wsId = 'ws-1' as WorkspaceId
    const repo = new FsSourceUnitObservationRepository({ workspaceRoots: workspaceRootsClosure(root, wsId) })
    await repo.save(makeState(wsId, 'src-a', 'foo.md', '1'))
    await repo.save(makeState(wsId, 'src-a', 'bar/', '2'))
    await repo.save(makeState(wsId, 'src-b', 'baz.md', '3'))

    const all = await repo.listByWorkspace(wsId)
    expect(all).toHaveLength(3)
  })

  it('listBySource filters to one source', async () => {
    const root = await makeRoot()
    const wsId = 'ws-1' as WorkspaceId
    const repo = new FsSourceUnitObservationRepository({ workspaceRoots: workspaceRootsClosure(root, wsId) })
    await repo.save(makeState(wsId, 'src-a', 'foo.md', '1'))
    await repo.save(makeState(wsId, 'src-b', 'bar.md', '2'))

    const a = await repo.listBySource(wsId, 'src-a' as SourceId)
    expect(a).toHaveLength(1)
    expect(a[0]!.sourceId).toBe('src-a')
  })

  it('handles folder units with trailing slash in path', async () => {
    const root = await makeRoot()
    const wsId = 'ws-1' as WorkspaceId
    const repo = new FsSourceUnitObservationRepository({ workspaceRoots: workspaceRootsClosure(root, wsId) })
    await repo.save(makeState(wsId, 'src', 'feature/', 'a'))
    const found = await repo.find(wsId, 'src' as SourceId, 'feature/')
    expect(found?.path).toBe('feature/')
  })
})
