import type {
  ClarifyCandidate,
  ClarifyCandidateId,
  ClarifyTicket as ClarifyTicketData,
  ClarifyTicketId,
  GraphOperation,
  NodeId,
  ProposalId,
  UserId,
  WorkspaceId,
} from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { ClarifyTicket, ConflictError, NotFoundError } from '../../../src/index.js'

const userId = 'u-1' as UserId

function candidate(id: string, ops: GraphOperation[] = []): ClarifyCandidate {
  return {
    id: id as ClarifyCandidateId,
    description: `option ${id}`,
    sourceReferences: [],
    proposedOperations: ops,
  }
}

function data(overrides: Partial<ClarifyTicketData> = {}): ClarifyTicketData {
  return {
    id: 'ct-1' as ClarifyTicketId,
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

describe('ClarifyTicket', () => {
  describe('resolveCandidate', () => {
    it('returns the candidate operations', () => {
      const ticket = new ClarifyTicket(data())
      const operations = ticket.resolveCandidate('cc-1' as ClarifyCandidateId)
      expect(operations).toHaveLength(1)
    })

    it('throws NotFoundError when candidate id missing', () => {
      const ticket = new ClarifyTicket(data())
      expect(() => ticket.resolveCandidate('missing' as ClarifyCandidateId)).toThrow(NotFoundError)
    })
  })

  describe('markAnswered', () => {
    it('moves pending → answered, stamping selectedCandidateId + resolution + answeredBy', () => {
      const answered = new ClarifyTicket(data()).markAnswered('cc-1' as ClarifyCandidateId, userId)

      expect(answered.status).toBe('answered')
      expect(answered.selectedCandidateId).toBe('cc-1')
      expect(answered.resolution).toEqual([{ operation: 'removeNode', nodeId: 'n-x' }])
    })

    it('throws ConflictError when ticket is not pending', () => {
      const ticket = new ClarifyTicket(data({ status: 'answered' }))
      expect(() => ticket.markAnswered('cc-1' as ClarifyCandidateId, userId)).toThrow(ConflictError)
    })

    it('throws NotFoundError when candidate id missing', () => {
      const ticket = new ClarifyTicket(data())
      expect(() => ticket.markAnswered('missing' as ClarifyCandidateId, userId)).toThrow(NotFoundError)
    })
  })

  describe('markApplied', () => {
    it('moves answered → applied and stamps proposalId when provided', () => {
      const answered = new ClarifyTicket(data({ status: 'answered', selectedCandidateId: 'cc-1' as ClarifyCandidateId }))
      const applied = answered.markApplied('p-1' as ProposalId)

      expect(applied.status).toBe('applied')
      expect(applied.proposalId).toBe('p-1')
    })

    it('moves answered → applied without proposalId for no-impact resolutions', () => {
      const answered = new ClarifyTicket(data({ status: 'answered', selectedCandidateId: 'cc-1' as ClarifyCandidateId }))
      const applied = answered.markApplied()

      expect(applied.status).toBe('applied')
      expect(applied.proposalId).toBeUndefined()
    })

    it('throws ConflictError when ticket is not answered (must answer first)', () => {
      const ticket = new ClarifyTicket(data())
      expect(() => ticket.markApplied('p-1' as ProposalId)).toThrow(ConflictError)
    })
  })

  describe('markSkipped', () => {
    it('returns a new ticket in skipped status', () => {
      const skipped = new ClarifyTicket(data()).markSkipped(userId)
      expect(skipped.status).toBe('skipped')
    })

    it('throws ConflictError when ticket is not pending', () => {
      const ticket = new ClarifyTicket(data({ status: 'skipped' }))
      expect(() => ticket.markSkipped(userId)).toThrow(ConflictError)
    })
  })

  describe('appendCandidate', () => {
    it('appends a new candidate while the ticket is pending', () => {
      const ticket = new ClarifyTicket(data())
      const extended = ticket.appendCandidate(candidate('cc-custom'))
      expect(extended.candidates.map(c => c.id)).toEqual(['cc-1', 'cc-2', 'cc-custom'])
      expect(extended.status).toBe('pending')
    })

    it('throws ConflictError on duplicate candidate id', () => {
      const ticket = new ClarifyTicket(data())
      expect(() => ticket.appendCandidate(candidate('cc-1'))).toThrow(ConflictError)
    })

    it('throws ConflictError when ticket is not pending', () => {
      const ticket = new ClarifyTicket(data({ status: 'answered' }))
      expect(() => ticket.appendCandidate(candidate('cc-custom'))).toThrow(ConflictError)
    })
  })
})
