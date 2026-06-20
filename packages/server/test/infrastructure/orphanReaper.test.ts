import type { Clock, Workspace } from '@braidhq/core'
import type {
  AbsolutePath,
  RunRecord,
  SkillId,
  SkillRunId,
  SourceId,
  WorkspaceId,
} from '@braidhq/schema'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InMemoryWorkspaceRepository } from '@braidhq/core/testing'
import { at, makeWorkspace, T0 } from '@braidhq/test-utils'
import { describe, expect, it } from 'vitest'
import { FsRunRepository } from '../../src/infrastructure/fs/FsRunRepository.js'
import { reapOrphanRuns } from '../../src/infrastructure/orphanReaper.js'

async function makeRoot(): Promise<AbsolutePath> {
  return (await mkdtemp(join(tmpdir(), 'braid-reaper-'))) as AbsolutePath
}

async function setupWorkspace(): Promise<{
  workspaceRepository: InMemoryWorkspaceRepository
  runRepository: FsRunRepository
  workspace: Workspace
}> {
  const rootPath = await makeRoot()
  const workspaceRepository = new InMemoryWorkspaceRepository()
  const workspace = makeWorkspace({
    id: 'ws-1',
    rootPath,
    sources: [{
      kind: 'filesystem',
      id: 'code' as SourceId,
      role: 'code',
      name: 'a',
      path: rootPath,
    }],
  })
  await workspaceRepository.save(workspace)
  return { workspaceRepository, runRepository: new FsRunRepository(), workspace }
}

function makeRunRecord(
  workspace: Workspace,
  overrides: Partial<RunRecord> & Pick<RunRecord, 'runId'>,
): RunRecord {
  return {
    workspaceId: workspace.id as WorkspaceId,
    skillId: 'braid-ask' as SkillId,
    args: '',
    resumed: false,
    startedAt: T0,
    ...overrides,
  } as RunRecord
}

// 5 minutes after the test-time anchor — reaper marks orphan runs at "now".
const REAPER_NOW = at(300)
const clock: Clock = { now: () => REAPER_NOW }

describe('reapOrphanRuns', () => {
  it('marks runs without completedAt as aborted; leaves completed runs alone', async () => {
    const { workspaceRepository, runRepository, workspace } = await setupWorkspace()
    const orphan = makeRunRecord(workspace, { runId: 'run-orphan' as SkillRunId })
    const completed = makeRunRecord(workspace, {
      runId: 'run-done' as SkillRunId,
      completedAt: at(60),
      exitCode: 0,
    })
    await runRepository.saveRecord(workspace, orphan)
    await runRepository.saveRecord(workspace, completed)

    const { reaped } = await reapOrphanRuns({ workspaceRepository, runRepository, clock })

    expect(reaped).toBe(1)
    const after = await runRepository.listRecords(workspace)
    const reapedRecord = after.find(record => record.runId === orphan.runId)!
    expect(reapedRecord.completedAt).toBe(REAPER_NOW)
    expect(reapedRecord.exitCode).toBe(-1)
    const stillDone = after.find(record => record.runId === completed.runId)!
    expect(stillDone.completedAt).toBe(at(60))
  })

  it('idempotent: a second call reaps nothing', async () => {
    const { workspaceRepository, runRepository, workspace } = await setupWorkspace()
    await runRepository.saveRecord(workspace, makeRunRecord(workspace, { runId: 'run-orphan' as SkillRunId }))

    await reapOrphanRuns({ workspaceRepository, runRepository, clock })
    const { reaped } = await reapOrphanRuns({ workspaceRepository, runRepository, clock })

    expect(reaped).toBe(0)
  })
})
