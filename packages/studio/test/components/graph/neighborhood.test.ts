import type { EdgeId, EdgeTypeId, GraphEdge, NodeId } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { computeNeighborhood } from '@/components/graph/neighborhood'

function edge(id: string, from: string, to: string): GraphEdge {
  return {
    id: id as EdgeId,
    type: 'contains' as EdgeTypeId,
    fromNodeId: from as NodeId,
    toNodeId: to as NodeId,
    metadata: { sourceReferences: [] },
  }
}

describe('computeNeighborhood', () => {
  const edges = [
    edge('e1', 'a', 'b'),
    edge('e2', 'a', 'c'),
    edge('e3', 'b', 'd'),
    edge('e4', 'x', 'y'),
  ]

  it('returns empty sets when no node is selected', () => {
    const n = computeNeighborhood(null, edges)
    expect(n.neighbors.size).toBe(0)
    expect(n.incidentEdges.size).toBe(0)
  })

  it('includes the selected node itself in neighbors', () => {
    const n = computeNeighborhood('a' as NodeId, edges)
    expect(n.neighbors.has('a' as NodeId)).toBe(true)
  })

  it('collects one-hop neighbors via either direction', () => {
    const n = computeNeighborhood('a' as NodeId, edges)
    expect([...n.neighbors].sort()).toEqual(['a', 'b', 'c'])
  })

  it('collects incident edges in either direction', () => {
    const n = computeNeighborhood('b' as NodeId, edges)
    expect([...n.incidentEdges].sort()).toEqual(['e1', 'e3'])
    expect([...n.neighbors].sort()).toEqual(['a', 'b', 'd'])
  })

  it('returns just the node when it has no edges', () => {
    const n = computeNeighborhood('lonely' as NodeId, edges)
    expect([...n.neighbors]).toEqual(['lonely'])
    expect(n.incidentEdges.size).toBe(0)
  })
})
