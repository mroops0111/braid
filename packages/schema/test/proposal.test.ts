import { T0 as isoTimestamp } from '@braidhq/test-utils'
import { describe, expect, it } from 'vitest'
import {
  GraphOperation,
  Proposal,
  ProposalCreate,
  ProposalFilter,
  ProposalStatus,
} from '../src/index.js'

const validNewGraphNode = { type: 'command', name: 'voidTask' }

describe('ProposalStatus', () => {
  it('has 3 states', () => {
    expect(ProposalStatus.options).toEqual(['pending', 'applied', 'rejected'])
  })
})

describe('GraphOperation', () => {
  const cases = [
    { name: 'addNode', payload: { operation: 'addNode', payload: validNewGraphNode } },
    { name: 'addNodes', payload: { operation: 'addNodes', payloads: [validNewGraphNode] } },
    { name: 'removeNode', payload: { operation: 'removeNode', nodeId: 'n-1' } },
    { name: 'removeNodes', payload: { operation: 'removeNodes', nodeIds: ['n-1', 'n-2'] } },
    {
      name: 'updateNode',
      payload: { operation: 'updateNode', nodeId: 'n-1', patch: { name: 'x' } },
    },
    {
      name: 'updateNodes',
      payload: { operation: 'updateNodes', updates: [{ nodeId: 'n-1', patch: { name: 'x' } }] },
    },
    {
      name: 'addEdge',
      payload: {
        operation: 'addEdge',
        payload: { type: 'contains', fromNodeId: 'n-1', toNodeId: 'n-2' },
      },
    },
    {
      name: 'addEdges',
      payload: {
        operation: 'addEdges',
        payloads: [{ type: 'contains', fromNodeId: 'n-1', toNodeId: 'n-2' }],
      },
    },
    { name: 'removeEdge', payload: { operation: 'removeEdge', edgeId: 'e-1' } },
    { name: 'removeEdges', payload: { operation: 'removeEdges', edgeIds: ['e-1'] } },
    {
      name: 'updateEdge',
      payload: { operation: 'updateEdge', edgeId: 'e-1', patch: { type: 'triggers' } },
    },
    {
      name: 'updateEdges',
      payload: {
        operation: 'updateEdges',
        updates: [{ edgeId: 'e-1', patch: { type: 'triggers' } }],
      },
    },
  ] as const

  it.each(cases)('accepts $name', ({ name, payload }) => {
    expect(GraphOperation.parse(payload).operation).toBe(name)
  })

  it('rejects unknown operation discriminator', () => {
    expect(GraphOperation.safeParse({ operation: 'mystery' }).success).toBe(false)
  })
})

describe('Proposal', () => {
  it('parses a complete pending proposal with mixed batch ops', () => {
    const proposal = Proposal.parse({
      id: 'p-1',
      workspaceId: 'w-1',
      status: 'pending',
      operations: [
        { operation: 'addNodes', payloads: [validNewGraphNode, validNewGraphNode] },
        { operation: 'removeEdges', edgeIds: ['e-1', 'e-2', 'e-3'] },
      ],
      generatedBy: 'extract',
      generatedAt: isoTimestamp,
      rationale: 'Adds 2 commands and removes 3 stale edges',
      owner: 'system',
    })
    expect(proposal.operations).toHaveLength(2)
  })

  it('accepts optional reviewer fields', () => {
    const proposal = Proposal.parse({
      id: 'p-1',
      workspaceId: 'w-1',
      status: 'applied',
      operations: [],
      generatedBy: 'extract',
      generatedAt: isoTimestamp,
      rationale: 'x',
      owner: 'system',
      reviewedBy: 'u-1',
      reviewedAt: isoTimestamp,
    })
    expect(proposal.reviewedBy).toBe('u-1')
  })

  it('accepts externalReferences (v2 forward-compat)', () => {
    const proposal = Proposal.parse({
      id: 'p-1',
      workspaceId: 'w-1',
      status: 'pending',
      operations: [],
      generatedBy: 'extract',
      generatedAt: isoTimestamp,
      rationale: 'x',
      owner: 'system',
      externalReferences: [{ kind: 'github', url: 'https://github.com/x/y/issues/1' }],
    })
    expect(proposal.externalReferences?.[0]?.kind).toBe('github')
  })

  it('rejects proposal without workspaceId', () => {
    expect(
      Proposal.safeParse({
        id: 'p-1',
        status: 'pending',
        operations: [],
        generatedBy: 'extract',
        generatedAt: isoTimestamp,
        rationale: 'x',
      }).success,
    ).toBe(false)
  })
})

describe('ProposalCreate', () => {
  it('does not require id / status / generatedAt', () => {
    const draft = ProposalCreate.parse({
      workspaceId: 'w-1',
      operations: [],
      generatedBy: 'extract',
      rationale: 'x',
    })
    expect(draft.rationale).toBe('x')
  })
})

describe('ProposalFilter', () => {
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
