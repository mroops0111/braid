import { describe, expect, it } from 'vitest'
import {
  GraphOperation,
  Proposal,
  ProposalDraft,
  ProposalFilter,
  ProposalStatus,
} from '../src/index.js'

const isoTimestamp = '2026-05-09T12:00:00+08:00'
const validNewGraphNode = { type: 'command', name: 'voidTask' }

describe('proposalStatus', () => {
  it('has 3 states', () => {
    expect(ProposalStatus.options).toEqual(['pending', 'applied', 'rejected'])
  })
})

describe('graphOperation', () => {
  const cases: { op: string, payload: unknown }[] = [
    { op: 'addNode', payload: { op: 'addNode', payload: validNewGraphNode } },
    { op: 'addNodes', payload: { op: 'addNodes', payloads: [validNewGraphNode] } },
    { op: 'removeNode', payload: { op: 'removeNode', nodeId: 'n-1' } },
    { op: 'removeNodes', payload: { op: 'removeNodes', nodeIds: ['n-1', 'n-2'] } },
    {
      op: 'updateNode',
      payload: { op: 'updateNode', nodeId: 'n-1', patch: { name: 'x' } },
    },
    {
      op: 'updateNodes',
      payload: {
        op: 'updateNodes',
        updates: [{ nodeId: 'n-1', patch: { name: 'x' } }],
      },
    },
    {
      op: 'addEdge',
      payload: {
        op: 'addEdge',
        payload: { type: 'contains', fromNodeId: 'n-1', toNodeId: 'n-2' },
      },
    },
    {
      op: 'addEdges',
      payload: {
        op: 'addEdges',
        payloads: [{ type: 'contains', fromNodeId: 'n-1', toNodeId: 'n-2' }],
      },
    },
    { op: 'removeEdge', payload: { op: 'removeEdge', edgeId: 'e-1' } },
    { op: 'removeEdges', payload: { op: 'removeEdges', edgeIds: ['e-1'] } },
    {
      op: 'updateEdge',
      payload: { op: 'updateEdge', edgeId: 'e-1', patch: { type: 'triggers' } },
    },
    {
      op: 'updateEdges',
      payload: {
        op: 'updateEdges',
        updates: [{ edgeId: 'e-1', patch: { type: 'triggers' } }],
      },
    },
  ]

  for (const { op, payload } of cases) {
    it(`accepts ${op}`, () => {
      expect(GraphOperation.parse(payload).op).toBe(op)
    })
  }

  it('rejects unknown op', () => {
    expect(GraphOperation.safeParse({ op: 'mystery' }).success).toBe(false)
  })
})

describe('proposal', () => {
  it('parses a complete pending proposal with mixed batch ops', () => {
    const proposal = Proposal.parse({
      id: 'p-1',
      status: 'pending',
      operations: [
        { op: 'addNodes', payloads: [validNewGraphNode, validNewGraphNode] },
        { op: 'removeEdges', edgeIds: ['e-1', 'e-2', 'e-3'] },
      ],
      generatedBy: 'extract',
      generatedAt: isoTimestamp,
      rationale: 'Adds 2 commands and removes 3 stale edges',
    })
    expect(proposal.operations).toHaveLength(2)
  })

  it('accepts optional reviewer fields', () => {
    const proposal = Proposal.parse({
      id: 'p-1',
      status: 'applied',
      operations: [],
      generatedBy: 'extract',
      generatedAt: isoTimestamp,
      rationale: 'x',
      reviewedBy: 'u-1',
      reviewedAt: isoTimestamp,
    })
    expect(proposal.reviewedBy).toBe('u-1')
  })

  it('accepts externalReferences (v2 forward-compat)', () => {
    const proposal = Proposal.parse({
      id: 'p-1',
      status: 'pending',
      operations: [],
      generatedBy: 'extract',
      generatedAt: isoTimestamp,
      rationale: 'x',
      externalReferences: [{ kind: 'github', url: 'https://github.com/x/y/issues/1' }],
    })
    expect(proposal.externalReferences?.[0]?.kind).toBe('github')
  })
})

describe('proposalDraft', () => {
  it('does not require id / status / generatedAt', () => {
    const draft = ProposalDraft.parse({
      operations: [],
      generatedBy: 'extract',
      rationale: 'x',
    })
    expect(draft.rationale).toBe('x')
  })
})

describe('proposalFilter', () => {
  it('all fields optional', () => {
    expect(ProposalFilter.parse({})).toEqual({})
  })
  it('accepts statuses + skill filters', () => {
    const filter = ProposalFilter.parse({
      statuses: ['pending'],
      generatedBy: ['extract', 'clarify'],
    })
    expect(filter.statuses).toEqual(['pending'])
  })
})
