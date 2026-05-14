import type { Clock } from '@telos/core'
import type {
  AbsolutePath,
  AgentBindingDescriptor,
  AgentId,
  ProductManifest,
  RunRecord,
  SkillId,
  SourceId,
  StorageKind,
  Timestamp,
  WorkspaceId,
} from '@telos/schema'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InMemoryWorkspaceRepository, Workspace } from '@telos/core'
import { describe, expect, it } from 'vitest'
import { FsRunRepository } from '../../src/infrastructure/fs/FsRunRepository.js'
import { reapOrphanRuns } from '../../src/infrastructure/orphanReaper.js'

const descriptor: AgentBindingDescriptor = {
  id: 'claude-default' as AgentId,
  kind: 'claude-code' as never,
  model: 'opus',
  effort: 'high',
  extraArgs: [],
  env: {},
}

function makeWorkspace(rootPath: AbsolutePath, id = 'ws-1' as WorkspaceId): Workspace {
  const manifest: ProductManifest = {
    name: 'demo',
    version: '0.0.0',
    ontologyId: 'ddd' as never,
    agents: { default: 'claude-default', tasks: {} },
    agentBindings: [descriptor],
    sources: [{
      kind: 'filesystem',
      id: 'code' as SourceId,
      role: 'code',
      name: 'a',
      path: rootPath,
    }],
    mcpServers: [],
    storage: { kind: 'in-memory' as StorageKind, config: {} },
    channels: [],
  }
  return new Workspace({
    id,
    rootPath,
    productManifest: manifest,
    pluginConfig: { plugins: [] },
  })
}

describe('reapOrphanRuns', () => {
  it('marks runs without completedAt as aborted; leaves completed runs alone', async () => {
    const rootPath = (await mkdtemp(join(tmpdir(), 'telos-reaper-'))) as AbsolutePath
    const workspaceRepository = new InMemoryWorkspaceRepository()
    const workspace = makeWorkspace(rootPath)
    await workspaceRepository.save(workspace)

    const runRepository = new FsRunRepository()
    const orphan: RunRecord = {
      runId: 'run-orphan' as never,
      workspaceId: workspace.id,
      skillId: 'telos-ask' as SkillId,
      args: '',
      resumed: false,
      startedAt: '2026-05-13T00:00:00+00:00',
    }
    const completed: RunRecord = {
      runId: 'run-done' as never,
      workspaceId: workspace.id,
      skillId: 'telos-ask' as SkillId,
      args: '',
      resumed: false,
      startedAt: '2026-05-13T00:00:00+00:00',
      completedAt: '2026-05-13T00:01:00+00:00',
      exitCode: 0,
    }
    await runRepository.saveRecord(workspace, orphan)
    await runRepository.saveRecord(workspace, completed)

    const clock: Clock = { now: () => '2026-05-13T00:05:00+00:00' as Timestamp }
    const { reaped } = await reapOrphanRuns({ workspaceRepository, runRepository, clock })

    expect(reaped).toBe(1)
    const after = await runRepository.listRecords(workspace)
    const reapedRecord = after.find(r => r.runId === orphan.runId)!
    expect(reapedRecord.completedAt).toBe('2026-05-13T00:05:00+00:00')
    expect(reapedRecord.exitCode).toBe(-1)
    const stillDone = after.find(r => r.runId === completed.runId)!
    expect(stillDone.completedAt).toBe('2026-05-13T00:01:00+00:00')
  })

  it('idempotent: a second call reaps nothing', async () => {
    const rootPath = (await mkdtemp(join(tmpdir(), 'telos-reaper-'))) as AbsolutePath
    const workspaceRepository = new InMemoryWorkspaceRepository()
    const workspace = makeWorkspace(rootPath)
    await workspaceRepository.save(workspace)

    const runRepository = new FsRunRepository()
    await runRepository.saveRecord(workspace, {
      runId: 'run-orphan' as never,
      workspaceId: workspace.id,
      skillId: 'telos-ask' as SkillId,
      args: '',
      resumed: false,
      startedAt: '2026-05-13T00:00:00+00:00',
    })

    const clock: Clock = { now: () => '2026-05-13T00:05:00+00:00' as Timestamp }
    await reapOrphanRuns({ workspaceRepository, runRepository, clock })
    const { reaped } = await reapOrphanRuns({ workspaceRepository, runRepository, clock })
    expect(reaped).toBe(0)
  })
})
