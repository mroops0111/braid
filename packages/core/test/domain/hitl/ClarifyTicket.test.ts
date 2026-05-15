import type {
  ClarifyCandidate,
  ClarifyCandidateId,
  ClarifyTicket as ClarifyTicketData,
  ClarifyTicketId,
  GraphOperation,
  NodeId,
  UserId,
  WorkspaceId,
} from '@telos/schema'
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

  describe('markApplied', () => {
    it('returns a new ticket in applied status with answeredBy + resolution', () => {
      const applied = new ClarifyTicket(data()).markApplied('cc-1' as ClarifyCandidateId, userId)
      expect(applied.status).toBe('applied')
      expect(applied.selectedCandidateId).toBe('cc-1')
    })

    it('throws ConflictError when ticket is not pending', () => {
      const ticket = new ClarifyTicket(data({ status: 'applied' }))
      expect(() => ticket.markApplied('cc-1' as ClarifyCandidateId, userId)).toThrow(ConflictError)
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
})
