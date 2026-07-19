import type { EdgeId, GraphOperation, NodeId } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { candidateLetter, formatOpsSummary, questionExcerpt, summarizeOps } from '../../src/pages/Clarification'

function addNode(id: string): GraphOperation {
  return {
    operation: 'addNode',
    payload: { id: id as NodeId, name: id, type: 'aggregate', status: 'draft' },
  } as GraphOperation
}

function addNodes(ids: string[]): GraphOperation {
  return {
    operation: 'addNodes',
    payloads: ids.map(id => ({ id: id as NodeId, name: id, type: 'aggregate', status: 'draft' })),
  } as GraphOperation
}

function removeEdge(id: string): GraphOperation {
  return { operation: 'removeEdge', edgeId: id as EdgeId } as GraphOperation
}

function removeEdges(ids: string[]): GraphOperation {
  return { operation: 'removeEdges', edgeIds: ids as EdgeId[] } as GraphOperation
}

function updateNode(id: string): GraphOperation {
  return { operation: 'updateNode', nodeId: id as NodeId, patch: { name: 'renamed' } } as GraphOperation
}

describe('summarizeOps', () => {
  it('returns zero counts when there are no operations', () => {
    expect(summarizeOps([])).toEqual({ adds: 0, updates: 0, removes: 0, total: 0 })
  })

  it('counts adds / removes / updates correctly across batch and non-batch ops', () => {
    const ops: GraphOperation[] = [
      addNode('a'),
      addNodes(['b', 'c', 'd']),
      updateNode('a'),
      removeEdge('e1'),
      removeEdges(['e2', 'e3']),
    ]
    expect(summarizeOps(ops)).toEqual({ adds: 4, updates: 1, removes: 3, total: 8 })
  })
})

describe('formatOpsSummary', () => {
  it('returns the empty-impact phrase for zero ops so the UI can render it as-is', () => {
    expect(formatOpsSummary({ adds: 0, updates: 0, removes: 0, total: 0 })).toBe('no graph impact')
  })

  it('renders only the non-zero buckets, ordered add/update/remove', () => {
    expect(formatOpsSummary({ adds: 2, updates: 0, removes: 3, total: 5 })).toBe('+2 / −3')
    expect(formatOpsSummary({ adds: 1, updates: 4, removes: 0, total: 5 })).toBe('+1 / ~4')
    expect(formatOpsSummary({ adds: 0, updates: 0, removes: 7, total: 7 })).toBe('−7')
  })
})

describe('candidateLetter', () => {
  it('maps 0 → A, 1 → B, 25 → Z', () => {
    expect(candidateLetter(0)).toBe('A')
    expect(candidateLetter(1)).toBe('B')
    expect(candidateLetter(25)).toBe('Z')
  })
})

describe('questionExcerpt', () => {
  it('collapses whitespace and returns the full text when within max length', () => {
    expect(questionExcerpt('  Is\nthis\tok? ', 80)).toBe('Is this ok?')
  })

  it('truncates with an ellipsis when the text exceeds max length', () => {
    const long = 'a'.repeat(120)
    const out = questionExcerpt(long, 10)
    expect(out).toHaveLength(10)
    expect(out.endsWith('…')).toBe(true)
  })
})
