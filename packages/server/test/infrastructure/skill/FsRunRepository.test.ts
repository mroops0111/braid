import type { AbsolutePath, RunRecord, SkillId, SkillRunId, UserId, WorkspaceId } from '@braidhq/schema'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { at, T0 as isoTimestamp } from '@braidhq/test-utils'
import { describe, expect, it } from 'vitest'
import { FsRunRepository } from '../../../src/infrastructure/skill/FsRunRepository.js'
import { makeWorkspace } from '../../helpers/fakes.js'

async function makeRoot(): Promise<AbsolutePath> {
  return (await mkdtemp(join(tmpdir(), 'braid-fs-run-'))) as AbsolutePath
}

function makeRecord(runId: string, overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: runId as SkillRunId,
    workspaceId: 'ws-1' as WorkspaceId,
    skillId: 'braid:ask' as SkillId,
    args: 'hi',
    resumed: false,
    startedBy: 'tester' as UserId,
    startedAt: isoTimestamp,
    ...overrides,
  }
}

describe('FsRunRepository', () => {
  it('returns no records when the index file does not exist yet', async () => {
    const root = await makeRoot()
    const repo = new FsRunRepository()

    expect(await repo.listRecords(makeWorkspace({ rootPath: root }))).toEqual([])
  })

  it('lists records in reverse-chronological order by startedAt', async () => {
    const root = await makeRoot()
    const workspace = makeWorkspace({ rootPath: root })
    const repo = new FsRunRepository()

    await repo.saveRecord(workspace, makeRecord('sr-old', { startedAt: at(0) }))
    await repo.saveRecord(workspace, makeRecord('sr-new', { startedAt: at(60) }))

    const records = await repo.listRecords(workspace)
    expect(records.map(record => record.runId)).toEqual(['sr-new', 'sr-old'])
  })

  it('collapses repeat saves of the same runId to a single last-write-wins record', async () => {
    const root = await makeRoot()
    const workspace = makeWorkspace({ rootPath: root })
    const repo = new FsRunRepository()

    await repo.saveRecord(workspace, makeRecord('sr-1'))
    await repo.saveRecord(workspace, makeRecord('sr-1', {
      sessionId: 'sess-abc',
      completedAt: isoTimestamp,
      exitCode: 0,
    }))

    const records = await repo.listRecords(workspace)
    expect(records).toHaveLength(1)
    expect(records[0]?.sessionId).toBe('sess-abc')
    expect(records[0]?.exitCode).toBe(0)
  })

  it('replays every appended event for a single run in append order', async () => {
    const root = await makeRoot()
    const workspace = makeWorkspace({ rootPath: root })
    const repo = new FsRunRepository()

    await repo.appendEvent(workspace, 'sr-1' as SkillRunId, { type: 'message', text: 'hello' })
    await repo.appendEvent(workspace, 'sr-1' as SkillRunId, { type: 'message', text: 'world' })

    const collected: string[] = []
    for await (const event of repo.readEvents(workspace, 'sr-1' as SkillRunId)) {
      if (event.type === 'message')
        collected.push(event.text)
    }
    expect(collected).toEqual(['hello', 'world'])
  })

  it('skips malformed lines without dropping the surrounding valid records', async () => {
    const root = await makeRoot()
    const workspace = makeWorkspace({ rootPath: root })
    const repo = new FsRunRepository()

    await repo.saveRecord(workspace, makeRecord('sr-1'))
    const { appendFile } = await import('node:fs/promises')
    const { runIndexPath } = await import('../../../src/infrastructure/_shared/paths.js')
    await appendFile(runIndexPath(root), 'not-json\n{"missing":"fields"}\n', 'utf-8')
    await repo.saveRecord(workspace, makeRecord('sr-2'))

    const records = await repo.listRecords(workspace)
    expect(records.map(record => record.runId).sort()).toEqual(['sr-1', 'sr-2'])
  })
})
