import type { AbsolutePath, Decision, DecisionId, ProposalId, UserId, WorkspaceId } from '@braidhq/schema'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NotFoundError } from '@braidhq/core'
import { T0 as isoTimestamp } from '@braidhq/test-utils'
import { describe, expect, it } from 'vitest'

import { FsDecisionRepository } from '../../../src/infrastructure/fs/FsDecisionRepository.js'

function makeDecision(id: string, workspaceId: WorkspaceId): Decision {
  return {
    id: id as DecisionId,
    workspaceId,
    timestamp: isoTimestamp,
    action: 'applyProposal',
    by: 'u-1' as UserId,
    references: { proposalId: 'p-1' as ProposalId },
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
