import type {
  ClarifyCandidate,
  ClarifyCandidateId,
  ClarifyTicket as ClarifyTicketData,
  ClarifyTicketId,
  GraphOperation,
  NodeId,
} from '@telos/schema'
import { describe, expect, it } from 'vitest'
import { ClarifyTicket, NotFoundError } from '../../../src/index.js'

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
    question: 'voidTask vs cancelTask: same?',
    candidates: [
      candidate('cc-1', [{ op: 'removeNode', nodeId: 'n-x' as NodeId }]),
      candidate('cc-2'),
    ],
    status: 'pending',
    ...overrides,
  }
}

describe('ClarifyTicket', () => {
  it('exposes underlying data', () => {
    const ticket = new ClarifyTicket(data())
    expect(ticket.id).toBe('ct-1')
    expect(ticket.candidates).toHaveLength(2)
  })

  describe('selectCandidate', () => {
    it('returns the selected candidate operations', () => {
      const ticket = new ClarifyTicket(data())
      const ops = ticket.selectCandidate('cc-1' as ClarifyCandidateId)
      expect(ops).toHaveLength(1)
      expect(ops[0]?.op).toBe('removeNode')
    })

    it('throws NotFoundError when candidate id missing', () => {
      const ticket = new ClarifyTicket(data())
      expect(() => ticket.selectCandidate('missing' as ClarifyCandidateId)).toThrow(NotFoundError)
    })
  })
})
