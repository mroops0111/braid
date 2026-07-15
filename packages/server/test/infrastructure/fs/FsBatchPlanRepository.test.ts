import type { AbsolutePath, BatchPlanId, BatchUnit, BatchUnitId, ProposalId, WorkspaceId } from '@braidhq/schema'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BatchPlan } from '@braidhq/core'
import { describe, expect, it } from 'vitest'
import { FsBatchPlanRepository } from '../../../src/infrastructure/fs/FsBatchPlanRepository.js'
import { makeWorkspace } from '../../helpers/fakes.js'

async function makeRoot(): Promise<AbsolutePath> {
  return (await mkdtemp(join(tmpdir(), 'braid-batch-plan-'))) as AbsolutePath
}

function makeUnit(id: string): BatchUnit {
  return {
    id: id as BatchUnitId,
    name: id,
    description: `walk ${id}`,
    status: 'pending',
    proposalIds: [],
    clarifyTicketIds: [],
  }
}

function makePlan(): BatchPlan {
  return new BatchPlan({
    id: 'bp-2026-06-03-aaaa' as BatchPlanId,
    workspaceId: 'w-1' as WorkspaceId,
    createdAt: '2026-06-03T00:00:00.000Z' as never,
    updatedAt: '2026-06-03T00:00:00.000Z' as never,
    mode: 'intent',
    status: 'running',
    autoApply: true,
    units: [makeUnit('pu-a'), makeUnit('pu-b')],
    checkpointPhases: [],
  })
}

describe('FsBatchPlanRepository', () => {
  it('load returns null before any write', async () => {
    const root = await makeRoot()
    const ws = makeWorkspace({ rootPath: root })
    expect(await new FsBatchPlanRepository().load(ws)).toBeNull()
  })

  it('round-trips a plan through save → load', async () => {
    const root = await makeRoot()
    const ws = makeWorkspace({ rootPath: root })
    const repo = new FsBatchPlanRepository()
    await repo.save(ws, makePlan())
    const loaded = await repo.load(ws)
    expect(loaded?.units.map(u => u.id)).toEqual(['pu-a', 'pu-b'])
    expect(loaded?.mode).toBe('intent')
    expect(loaded?.autoApply).toBe(true)
  })

  it('save overwrites the previous plan', async () => {
    const root = await makeRoot()
    const ws = makeWorkspace({ rootPath: root })
    const repo = new FsBatchPlanRepository()
    await repo.save(ws, makePlan())
    const next = makePlan().markUnitCompleted(
      '2026-06-03T00:00:01.000Z' as never,
      'pu-a' as BatchUnitId,
      { proposalIds: ['p-1' as ProposalId], clarifyTicketIds: [] },
    )
    await repo.save(ws, next)
    const loaded = await repo.load(ws)
    expect(loaded?.units.find(u => u.id === 'pu-a')?.status).toBe('completed')
  })

  it('clear removes the file', async () => {
    const root = await makeRoot()
    const ws = makeWorkspace({ rootPath: root })
    const repo = new FsBatchPlanRepository()
    await repo.save(ws, makePlan())
    expect(await repo.load(ws)).not.toBeNull()
    await repo.clear(ws)
    expect(await repo.load(ws)).toBeNull()
  })
})
