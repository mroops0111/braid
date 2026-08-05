import type { AbsolutePath, BatchUnitId, ProposalId } from '@braidhq/schema'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makePlan } from '@braidhq/test-utils'
import { describe, expect, it } from 'vitest'
import { FsBatchPlanRepository } from '../../../src/infrastructure/batch/FsBatchPlanRepository.js'
import { makeWorkspace } from '../../helpers/fakes.js'

async function makeRoot(): Promise<AbsolutePath> {
  return (await mkdtemp(join(tmpdir(), 'braid-batch-plan-'))) as AbsolutePath
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
    await repo.save(ws, makePlan({ status: 'running', autoApply: true }))
    const loaded = await repo.load(ws)
    expect(loaded?.units.map(u => u.id)).toEqual(['pu-a', 'pu-b'])
    expect(loaded?.mode).toBe('direct')
    expect(loaded?.autoApply).toBe(true)
  })

  it('save overwrites the previous plan', async () => {
    const root = await makeRoot()
    const ws = makeWorkspace({ rootPath: root })
    const repo = new FsBatchPlanRepository()
    await repo.save(ws, makePlan({ status: 'running', autoApply: true }))
    const next = makePlan({ status: 'running', autoApply: true }).markUnitCompleted(
      '2026-06-03T00:00:01.000Z' as never,
      'pu-a' as BatchUnitId,
      { proposalIds: ['p-1' as ProposalId], clarificationIds: [] },
    )
    await repo.save(ws, next)
    const loaded = await repo.load(ws)
    expect(loaded?.units.find(u => u.id === 'pu-a')?.status).toBe('completed')
  })

  it('clear removes the file', async () => {
    const root = await makeRoot()
    const ws = makeWorkspace({ rootPath: root })
    const repo = new FsBatchPlanRepository()
    await repo.save(ws, makePlan({ status: 'running', autoApply: true }))
    expect(await repo.load(ws)).not.toBeNull()
    await repo.clear(ws)
    expect(await repo.load(ws)).toBeNull()
  })
})
