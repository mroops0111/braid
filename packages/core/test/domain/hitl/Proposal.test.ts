import type { GraphOperation, NewGraphNode, NodeId, Proposal as ProposalData, ProposalId, SkillId } from '@telos/schema'
import { describe, expect, it } from 'vitest'
import { Model, Proposal } from '../../../src/index.js'

const isoTimestamp = '2026-05-09T12:00:00+08:00'

function operations(overrides: GraphOperation[] = []): GraphOperation[] {
  return overrides.length > 0
    ? overrides
    : [{
        op: 'addNode',
        payload: { type: 'command', name: 'voidTask', id: 'n-1' as NodeId } as NewGraphNode,
      }]
}

function data(overrides: Partial<ProposalData> = {}): ProposalData {
  return {
    id: 'p-1' as ProposalId,
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

  describe('apply', () => {
    it('applies operations to a model and returns the new snapshot', () => {
      const model = new Model()
      const proposal = new Proposal(data())
      const snapshot = proposal.apply(model)
      expect(snapshot.nodes).toHaveLength(1)
    })

    it('rolls back atomically on op failure', () => {
      const model = new Model()
      const proposal = new Proposal(data({
        operations: [
          { op: 'addNode', payload: { type: 'command', name: 'a', id: 'n-1' as NodeId } as NewGraphNode },
          { op: 'removeNode', nodeId: 'missing' as NodeId },
        ],
      }))
      expect(() => proposal.apply(model)).toThrow()
      expect(model.toSnapshot().nodes).toEqual([])
    })
  })
})
