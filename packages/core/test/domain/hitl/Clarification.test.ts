import type {
  ClarificationCandidate,
  ClarificationCandidateId,
  Clarification as ClarificationData,
  ClarificationId,
  GraphOperation,
  NodeId,
  ProposalId,
  UserId,
  WorkspaceId,
} from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { Clarification, ConflictError, NotFoundError } from '../../../src/index.js'

const userId = 'u-1' as UserId

function candidate(id: string, ops: GraphOperation[] = []): ClarificationCandidate {
  return {
    id: id as ClarificationCandidateId,
    description: `option ${id}`,
    sourceReferences: [],
    proposedOperations: ops,
  }
}

function data(overrides: Partial<ClarificationData> = {}): ClarificationData {
  return {
    id: 'ct-1' as ClarificationId,
    workspaceId: 'w-1' as WorkspaceId,
    question: 'voidTask vs cancelTask: same?',
    candidates: [
      candidate('cc-1', [{ operation: 'removeNode', nodeId: 'n-x' as NodeId }]),
      candidate('cc-2'),
    ],
    status: 'pending',
    owner: 'system',
    origin: 'skill',
    ...overrides,
  }
}

describe('Clarification', () => {
  describe('resolveCandidate', () => {
    it('returns the candidate operations', () => {
      const ticket = new Clarification(data())
      const operations = ticket.resolveCandidate('cc-1' as ClarificationCandidateId)
      expect(operations).toHaveLength(1)
    })

    it('throws NotFoundError when candidate id missing', () => {
      const ticket = new Clarification(data())
      expect(() => ticket.resolveCandidate('missing' as ClarificationCandidateId)).toThrow(NotFoundError)
    })
  })

  describe('markAnswered', () => {
    it('moves pending → answered, stamping selectedCandidateId + resolution + answeredBy', () => {
      const answered = new Clarification(data()).markAnswered('cc-1' as ClarificationCandidateId, userId)

      expect(answered.status).toBe('answered')
      expect(answered.selectedCandidateId).toBe('cc-1')
      expect(answered.resolution).toEqual([{ operation: 'removeNode', nodeId: 'n-x' }])
    })

    it('throws ConflictError when ticket is not pending', () => {
      const ticket = new Clarification(data({ status: 'answered' }))
      expect(() => ticket.markAnswered('cc-1' as ClarificationCandidateId, userId)).toThrow(ConflictError)
    })

    it('throws NotFoundError when candidate id missing', () => {
      const ticket = new Clarification(data())
      expect(() => ticket.markAnswered('missing' as ClarificationCandidateId, userId)).toThrow(NotFoundError)
    })
  })

  describe('markApplied', () => {
    it('moves answered → applied and stamps proposalId when provided', () => {
      const answered = new Clarification(data({ status: 'answered', selectedCandidateId: 'cc-1' as ClarificationCandidateId }))
      const applied = answered.markApplied('p-1' as ProposalId)

      expect(applied.status).toBe('applied')
      expect(applied.proposalId).toBe('p-1')
    })

    it('moves answered → applied without proposalId for no-impact resolutions', () => {
      const answered = new Clarification(data({ status: 'answered', selectedCandidateId: 'cc-1' as ClarificationCandidateId }))
      const applied = answered.markApplied()

      expect(applied.status).toBe('applied')
      expect(applied.proposalId).toBeUndefined()
    })

    it('throws ConflictError when ticket is not answered (must answer first)', () => {
      const ticket = new Clarification(data())
      expect(() => ticket.markApplied('p-1' as ProposalId)).toThrow(ConflictError)
    })
  })

  describe('markSkipped', () => {
    it('returns a new ticket in skipped status', () => {
      const skipped = new Clarification(data()).markSkipped(userId)
      expect(skipped.status).toBe('skipped')
    })

    it('throws ConflictError when ticket is not pending', () => {
      const ticket = new Clarification(data({ status: 'skipped' }))
      expect(() => ticket.markSkipped(userId)).toThrow(ConflictError)
    })
  })

  describe('appendCandidate', () => {
    it('appends a new candidate while the ticket is pending', () => {
      const ticket = new Clarification(data())
      const extended = ticket.appendCandidate(candidate('cc-custom'))
      expect(extended.candidates.map(c => c.id)).toEqual(['cc-1', 'cc-2', 'cc-custom'])
      expect(extended.status).toBe('pending')
    })

    it('throws ConflictError on duplicate candidate id', () => {
      const ticket = new Clarification(data())
      expect(() => ticket.appendCandidate(candidate('cc-1'))).toThrow(ConflictError)
    })

    it('throws ConflictError when ticket is not pending', () => {
      const ticket = new Clarification(data({ status: 'answered' }))
      expect(() => ticket.appendCandidate(candidate('cc-custom'))).toThrow(ConflictError)
    })
  })
})
