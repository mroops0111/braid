import type { EdgeId, EdgeTypeId, GraphEdge, GraphNode, NodeId, NodeTypeId, ProposalDiff } from '@braidhq/schema'
import type { GraphDataSource } from '@/components/graph/GraphDataSource'
import { describe, expect, it } from 'vitest'
import { emphasizeAddedFor, narrowToChanges } from '@/components/graph/GraphDataSource'

function node(id: string): GraphNode {
  return {
    id: id as NodeId,
    type: 'context' as NodeTypeId,
    name: id,
    status: 'draft',
    metadata: { sourceReferences: [] },
  }
}

function edge(id: string, from: string, to: string): GraphEdge {
  return {
    id: id as EdgeId,
    type: 'contains' as EdgeTypeId,
    fromNodeId: from as NodeId,
    toNodeId: to as NodeId,
    metadata: { sourceReferences: [] },
  }
}

function diffOf(nodeIds: readonly string[]): ProposalDiff {
  return {
    nodes: new Map(nodeIds.map(id => [id as NodeId, 'added'])),
    edges: new Map(),
  }
}

function source(nodeIds: readonly string[], edges: readonly GraphEdge[], diff?: ProposalDiff): GraphDataSource {
  return {
    nodes: nodeIds.map(node),
    edges,
    isLoading: false,
    isEmpty: nodeIds.length === 0,
    ...(diff ? { diff } : {}),
  }
}

describe('emphasizeAddedFor', () => {
  it('emphasises a change that touches a small part of what is drawn', () => {
    const drawn = Array.from({ length: 20 }, (_, index) => `n${index}`)
    expect(emphasizeAddedFor(source(drawn, [], diffOf(['n0', 'n1'])))).toBe(true)
  })

  // A fresh extraction touches nearly everything, and a green border on every
  // node would drown the type colour the cards are read by.
  it('leaves a change that touches most of what is drawn unemphasised', () => {
    const drawn = ['a', 'b', 'c']
    expect(emphasizeAddedFor(source(drawn, [], diffOf(drawn)))).toBe(false)
  })

  // Nothing drawn is not an incremental change, it is no change, and the
  // ratio has to fall on that side or an empty canvas reads as a diff.
  it('treats an empty source as unemphasised', () => {
    expect(emphasizeAddedFor(source([], []))).toBe(false)
  })
})

describe('narrowToChanges', () => {
  const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'c'), edge('e3', 'x', 'y')]

  it('keeps the changed nodes and one hop of context', () => {
    const narrowed = narrowToChanges(source(['a', 'b', 'c', 'x', 'y'], edges, diffOf(['b'])))
    expect(narrowed.nodes.map(n => n.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('drops edges whose other end fell outside the narrowing', () => {
    const narrowed = narrowToChanges(source(['a', 'b', 'c', 'x', 'y'], edges, diffOf(['b'])))
    expect(narrowed.edges.map(e => e.id).sort()).toEqual(['e1', 'e2'])
  })

  it('returns the source untouched when nothing changed', () => {
    const full = source(['a', 'b'], edges)
    expect(narrowToChanges(full)).toBe(full)
  })
})
