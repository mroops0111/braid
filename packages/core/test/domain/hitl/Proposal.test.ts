import type {
  GraphOperation,
  NewGraphNode,
  NodeId,
  NodeStatus,
  NodeTypeId,
  Proposal as ProposalData,
  ProposalId,
  SkillId,
  UserId,
  WorkspaceId,
} from '@braidhq/schema'
import { T0 } from '@braidhq/test-utils'
import { describe, expect, it } from 'vitest'
import { ConflictError, Proposal } from '../../../src/index.js'

const userId = 'u-1' as UserId

function defaultOperations(): GraphOperation[] {
  return [{
    operation: 'addNode',
    payload: {
      type: 'command' as NodeTypeId,
      name: 'voidTask',
      id: 'n-1' as NodeId,
      status: 'draft' as NodeStatus,
    } satisfies NewGraphNode,
  }]
}

function proposalData(overrides: Partial<ProposalData> = {}): ProposalData {
  return {
    id: 'p-1' as ProposalId,
    workspaceId: 'w-1' as WorkspaceId,
    status: 'pending',
    operations: defaultOperations(),
    generatedBy: 'extract' as SkillId,
    generatedAt: T0,
    rationale: 'add voidTask',
    ...overrides,
  }
}

describe('Proposal', () => {
  describe('markApplied', () => {
    it('returns a new Proposal in applied status with reviewer + timestamp', () => {
      const applied = new Proposal(proposalData()).markApplied(userId, T0)
      expect(applied.status).toBe('applied')
      expect(applied.reviewedBy).toBe(userId)
    })

    it('throws ConflictError when proposal is not pending', () => {
      const proposal = new Proposal(proposalData({ status: 'applied' }))
      expect(() => proposal.markApplied(userId, T0)).toThrow(ConflictError)
    })
  })

  describe('markRejected', () => {
    it('returns a new Proposal in rejected status', () => {
      const rejected = new Proposal(proposalData()).markRejected(userId, T0)
      expect(rejected.status).toBe('rejected')
    })

    it('throws ConflictError when proposal is not pending', () => {
      const proposal = new Proposal(proposalData({ status: 'rejected' }))
      expect(() => proposal.markRejected(userId, T0)).toThrow(ConflictError)
    })
  })
})
