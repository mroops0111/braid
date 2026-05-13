import type {
  AbsolutePath,
  AgentBindingDescriptor,
  AgentId,
  ProductManifest,
  RunRecord,
  SkillRunId,
  SourceId,
  StorageKind,
  WorkspaceId,
} from '@telos/schema'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Workspace } from '@telos/core'
import { describe, expect, it } from 'vitest'
import { FsRunRepository } from '../../../src/infrastructure/fs/FsRunRepository.js'

const isoTimestamp = '2026-05-12T12:00:00+08:00'

function makeWorkspace(rootPath: AbsolutePath): Workspace {
  const descriptor: AgentBindingDescriptor = {
    id: 'claude-default' as AgentId,
    kind: 'claude-code' as never,
    model: 'opus',
    effort: 'high',
    extraArgs: [],
    env: {},
  }
  const manifest: ProductManifest = {
    name: 'demo',
    version: '0.0.0',
    ontologyId: 'ddd' as never,
    agents: { default: 'claude-default', tasks: {} },
    agentBindings: [descriptor],
    sources: [{ kind: 'filesystem', id: 'src' as SourceId, role: 'code', name: 'a', path: rootPath }],
    mcpServers: [],
    storage: { kind: 'in-memory' as StorageKind, config: {} },
    channels: [],
  }
  return new Workspace({
    id: 'demo' as WorkspaceId,
    rootPath,
    productManifest: manifest,
    pluginConfig: { plugins: [] },
  })
}

function makeRecord(runId: string, overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: runId as SkillRunId,
    workspaceId: 'demo' as WorkspaceId,
    skillId: 'telos-ask' as never,
    args: 'hi',
    resumed: false,
    startedAt: isoTimestamp as never,
    ...overrides,
  }
}

describe('FsRunRepository', () => {
  it('listRecords returns empty array when index file does not exist', async () => {
    const root = (await mkdtemp(join(tmpdir(), 'telos-fs-run-'))) as AbsolutePath
    const repo = new FsRunRepository()
    expect(await repo.listRecords(makeWorkspace(root))).toEqual([])
  })

  it('saveRecord + listRecords round-trip, sorted reverse-chronological', async () => {
    const root = (await mkdtemp(join(tmpdir(), 'telos-fs-run-'))) as AbsolutePath
    const ws = makeWorkspace(root)
    const repo = new FsRunRepository()

    await repo.saveRecord(ws, makeRecord('sr-old', { startedAt: '2026-01-01T00:00:00+08:00' as never }))
    await repo.saveRecord(ws, makeRecord('sr-new', { startedAt: '2026-06-01T00:00:00+08:00' as never }))

    const records = await repo.listRecords(ws)
    expect(records.map(r => r.runId)).toEqual(['sr-new', 'sr-old'])
  })

  it('last write per runId wins (progress updates collapse)', async () => {
    const root = (await mkdtemp(join(tmpdir(), 'telos-fs-run-'))) as AbsolutePath
    const ws = makeWorkspace(root)
    const repo = new FsRunRepository()

    await repo.saveRecord(ws, makeRecord('sr-1'))
    await repo.saveRecord(ws, makeRecord('sr-1', {
      sessionId: 'sess-abc',
      completedAt: isoTimestamp as never,
      exitCode: 0,
    }))

    const records = await repo.listRecords(ws)
    expect(records).toHaveLength(1)
    expect(records[0]?.sessionId).toBe('sess-abc')
    expect(records[0]?.exitCode).toBe(0)
  })

  it('appendEvent + readEvents stream a run\'s full event log', async () => {
    const root = (await mkdtemp(join(tmpdir(), 'telos-fs-run-'))) as AbsolutePath
    const ws = makeWorkspace(root)
    const repo = new FsRunRepository()

    await repo.appendEvent(ws, 'sr-1' as SkillRunId, { type: 'message', text: 'hello' })
    await repo.appendEvent(ws, 'sr-1' as SkillRunId, { type: 'message', text: 'world' })

    const collected: string[] = []
    for await (const event of repo.readEvents(ws, 'sr-1' as SkillRunId)) {
      if (event.type === 'message')
        collected.push(event.text)
    }
    expect(collected).toEqual(['hello', 'world'])
  })

  it('skips malformed lines in index and events files', async () => {
    const root = (await mkdtemp(join(tmpdir(), 'telos-fs-run-'))) as AbsolutePath
    const ws = makeWorkspace(root)
    const repo = new FsRunRepository()

    // Intermix valid record with garbage.
    await repo.saveRecord(ws, makeRecord('sr-1'))
    const { appendFile } = await import('node:fs/promises')
    const { runIndexPath } = await import('../../../src/infrastructure/fs/paths.js')
    await appendFile(runIndexPath(root), 'not-json\n{"missing":"fields"}\n', 'utf-8')
    await repo.saveRecord(ws, makeRecord('sr-2'))

    const records = await repo.listRecords(ws)
    expect(records.map(r => r.runId).sort()).toEqual(['sr-1', 'sr-2'])
  })
})
