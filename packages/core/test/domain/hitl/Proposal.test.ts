import type {
  GraphOperation,
  NewGraphNode,
  NodeId,
  Proposal as ProposalData,
  ProposalId,
  SkillId,
  Timestamp,
  UserId,
  WorkspaceId,
} from '@telos/schema'
import { describe, expect, it } from 'vitest'
import { ConflictError, Proposal } from '../../../src/index.js'

const isoTimestamp = '2026-05-09T12:00:00+08:00' as Timestamp
const userId = 'u-1' as UserId

function operations(overrides: GraphOperation[] = []): GraphOperation[] {
  return overrides.length > 0
    ? overrides
    : [{
        operation: 'addNode',
        payload: { type: 'command', name: 'voidTask', id: 'n-1' as NodeId } as NewGraphNode,
      }]
}

function data(overrides: Partial<ProposalData> = {}): ProposalData {
  return {
    id: 'p-1' as ProposalId,
    workspaceId: 'w-1' as WorkspaceId,
    status: 'pending',
    operations: operations(),
    generatedBy: 'extract' as SkillId,
    generatedAt: isoTimestamp,
    rationale: 'add voidTask',
    ...overrides,
  }
}

describe('Proposal', () => {
  it('exposes underlying data', () => {
    const proposal = new Proposal(data())
    expect(proposal.id).toBe('p-1')
    expect(proposal.status).toBe('pending')
    expect(proposal.operations).toHaveLength(1)
  })

  describe('markApplied', () => {
    it('returns a new Proposal in applied status with reviewer + timestamp', () => {
      const applied = new Proposal(data()).markApplied(userId, isoTimestamp)
      expect(applied.status).toBe('applied')
      expect(applied.reviewedBy).toBe(userId)
    })

    it('throws ConflictError when proposal is not pending', () => {
      const proposal = new Proposal(data({ status: 'applied' }))
      expect(() => proposal.markApplied(userId, isoTimestamp)).toThrow(ConflictError)
    })
  })

  describe('markRejected', () => {
    it('returns a new Proposal in rejected status', () => {
      const rejected = new Proposal(data()).markRejected(userId, isoTimestamp)
      expect(rejected.status).toBe('rejected')
    })

    it('throws ConflictError when proposal is not pending', () => {
      const proposal = new Proposal(data({ status: 'rejected' }))
      expect(() => proposal.markRejected(userId, isoTimestamp)).toThrow(ConflictError)
    })
  })
})
