import type { AbsolutePath, ProposalId, SkillId, WorkspaceId } from '@braidhq/schema'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NotFoundError, Proposal } from '@braidhq/core'
import { T0 as isoTimestamp } from '@braidhq/test-utils'
import { describe, expect, it } from 'vitest'

import { FsProposalRepository } from '../../../src/infrastructure/fs/FsProposalRepository.js'

async function makeWorkspaceRoot(): Promise<AbsolutePath> {
  return await mkdtemp(join(tmpdir(), 'braid-fs-prop-')) as AbsolutePath
}

function makeProposal(id: string, workspaceId: WorkspaceId, status: 'pending' | 'applied' | 'rejected' = 'pending'): Proposal {
  return new Proposal({
    id: id as ProposalId,
    workspaceId,
    status,
    operations: [],
    generatedBy: 'extract' as SkillId,
    generatedAt: isoTimestamp,
    rationale: 'r',
  })
}

describe('FsProposalRepository', () => {
  it('save then load round-trips proposal', async () => {
    const root = await makeWorkspaceRoot()
    const workspaceId = 'ws-1' as WorkspaceId
    const repository = new FsProposalRepository({
      workspaceRoots: async () => new Map([[workspaceId, root]]),
    })
    await repository.save(makeProposal('p-1', workspaceId))
    const reloaded = await repository.load('p-1' as ProposalId)
    expect(reloaded.id).toBe('p-1')
    expect(reloaded.status).toBe('pending')
  })

  it('save moves file when status transitions', async () => {
    const root = await makeWorkspaceRoot()
    const workspaceId = 'ws-1' as WorkspaceId
    const repository = new FsProposalRepository({
      workspaceRoots: async () => new Map([[workspaceId, root]]),
    })
    await repository.save(makeProposal('p-1', workspaceId, 'pending'))
    await repository.save(makeProposal('p-1', workspaceId, 'applied'))

    const appliedPath = join(root, 'artifacts/proposals/applied/p-1.json')
    const parsed = JSON.parse(await readFile(appliedPath, 'utf-8'))
    expect(parsed.status).toBe('applied')
  })

  it('list filters by workspaceId and status', async () => {
    const root = await makeWorkspaceRoot()
    const workspaceId = 'ws-1' as WorkspaceId
    const repository = new FsProposalRepository({
      workspaceRoots: async () => new Map([[workspaceId, root]]),
    })
    await repository.save(makeProposal('p-1', workspaceId, 'pending'))
    await repository.save(makeProposal('p-2', workspaceId, 'applied'))

    const pending = await repository.list({ workspaceId, statuses: ['pending'] })
    expect(pending.map(p => p.id)).toEqual(['p-1'])
  })

  it('load throws NotFoundError when proposal missing', async () => {
    const root = await makeWorkspaceRoot()
    const workspaceId = 'ws-1' as WorkspaceId
    const repository = new FsProposalRepository({
      workspaceRoots: async () => new Map([[workspaceId, root]]),
    })
    await expect(
      repository.load('missing' as ProposalId),
    ).rejects.toThrow(NotFoundError)
  })
})
