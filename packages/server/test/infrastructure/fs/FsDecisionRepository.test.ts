import type { AbsolutePath, Decision, DecisionId, WorkspaceId } from '@braidhq/schema'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NotFoundError } from '@braidhq/core'
import { describe, expect, it } from 'vitest'
import { FsDecisionRepository } from '../../../src/infrastructure/fs/FsDecisionRepository.js'

const isoTimestamp = '2026-05-12T12:00:00+08:00'

function makeDecision(id: string, workspaceId: WorkspaceId): Decision {
  return {
    id: id as DecisionId,
    workspaceId,
    timestamp: isoTimestamp as never,
    action: 'applyProposal',
    by: 'u-1' as never,
    references: { proposalId: 'p-1' as never },
  }
}

describe('FsDecisionRepository', () => {
  it('append + list + load round-trip', async () => {
    const root = (await mkdtemp(join(tmpdir(), 'braid-fs-dec-'))) as AbsolutePath
    const workspaceId = 'ws-1' as WorkspaceId
    const repository = new FsDecisionRepository({
      workspaceRoots: async () => new Map([[workspaceId, root]]),
    })

    await repository.append(makeDecision('d-1', workspaceId))
    const listed = await repository.list({ workspaceId })
    expect(listed.map(d => d.id)).toEqual(['d-1'])

    const loaded = await repository.load('d-1' as DecisionId)
    expect(loaded.action).toBe('applyProposal')
  })

  it('load throws NotFoundError for unknown decision', async () => {
    const root = (await mkdtemp(join(tmpdir(), 'braid-fs-dec-'))) as AbsolutePath
    const workspaceId = 'ws-1' as WorkspaceId
    const repository = new FsDecisionRepository({
      workspaceRoots: async () => new Map([[workspaceId, root]]),
    })
    await expect(
      repository.load('missing' as DecisionId),
    ).rejects.toThrow(NotFoundError)
  })
})
