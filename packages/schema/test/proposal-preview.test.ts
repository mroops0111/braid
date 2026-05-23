import type {
  EdgeId,
  EdgeTypeId,
  GraphEdge,
  GraphNode,
  ModelSnapshot,
  NodeId,
  NodeStatus,
  NodeTypeId,
} from '../src/index.js'
import { describe, expect, it } from 'vitest'
import { previewProposal } from '../src/index.js'

function node(id: string, overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: id as NodeId,
    type: 'command' as NodeTypeId,
    name: id,
    status: 'draft' as NodeStatus,
    metadata: { sourceReferences: [] },
    ...overrides,
  }
}

function edge(id: string, from: string, to: string, overrides: Partial<GraphEdge> = {}): GraphEdge {
  return {
    id: id as EdgeId,
    type: 'contains' as EdgeTypeId,
    fromNodeId: from as NodeId,
    toNodeId: to as NodeId,
    metadata: { sourceReferences: [] },
    ...overrides,
  }
}

function snapshot(nodes: GraphNode[], edges: GraphEdge[] = []): ModelSnapshot {
  return { nodes, edges }
}

describe('previewProposal', () => {
  it('classifies addNode as added', () => {
    const { snapshot: next, diff } = previewProposal(snapshot([]), [
      { operation: 'addNode', payload: { id: 'n1' as NodeId, type: 'command' as NodeTypeId, name: 'n1', status: 'draft' as NodeStatus } },
    ])
    expect(next.nodes).toHaveLength(1)
    expect(diff.nodes.get('n1' as NodeId)).toBe('added')
  })

  it('classifies removeNode as removed and cascade-deletes incident edges', () => {
    const base = snapshot(
      [node('n1'), node('n2')],
      [edge('e1', 'n1', 'n2')],
    )
    const { snapshot: next, diff } = previewProposal(base, [
      { operation: 'removeNode', nodeId: 'n1' as NodeId },
    ])
    expect(next.nodes.map(n => n.id)).toEqual(['n2'])
    expect(next.edges).toEqual([])
    expect(diff.nodes.get('n1' as NodeId)).toBe('removed')
    expect(diff.edges.get('e1' as EdgeId)).toBe('removed')
  })

  it('classifies updateNode as updated only when content actually changes', () => {
    const base = snapshot([node('n1', { name: 'old' })])
    const { diff } = previewProposal(base, [
      { operation: 'updateNode', nodeId: 'n1' as NodeId, patch: { name: 'new' } },
    ])
    expect(diff.nodes.get('n1' as NodeId)).toBe('updated')
  })

  it('does not mark a node as updated when the patch is a no-op', () => {
    const base = snapshot([node('n1', { name: 'same' })])
    const { diff } = previewProposal(base, [
      { operation: 'updateNode', nodeId: 'n1' as NodeId, patch: { name: 'same' } },
    ])
    expect(diff.nodes.has('n1' as NodeId)).toBe(false)
  })

  it('treats undefined patch keys as "leave unchanged" instead of overwriting', () => {
    const base = snapshot([node('n1', { name: 'kept', description: 'kept-desc' })])
    const { snapshot: next, diff } = previewProposal(base, [
      { operation: 'updateNode', nodeId: 'n1' as NodeId, patch: { description: undefined } },
    ])
    // description should NOT be wiped out — undefined means "no change"
    expect(next.nodes[0]!.description).toBe('kept-desc')
    expect(diff.nodes.has('n1' as NodeId)).toBe(false)
  })

  it('detects sourceReferences additions structurally (not by JSON shape)', () => {
    const base = snapshot([node('n1', {
      metadata: { sourceReferences: [] },
    })])
    const { diff } = previewProposal(base, [
      {
        operation: 'updateNode',
        nodeId: 'n1' as NodeId,
        patch: {
          metadata: {
            sourceReferences: [{ sourceId: 'prd' as never, location: { uri: 'doc.md' as never } }],
          },
        },
      },
    ])
    expect(diff.nodes.get('n1' as NodeId)).toBe('updated')
  })

  it('does not mark a node as updated when the metadata contents are equivalent', () => {
    // Two sourceReferences with the same content but constructed with
    // different object literal key orders should compare equal under
    // the structural comparator (the previous JSON.stringify-based
    // check was order-sensitive).
    const refA = { snippet: 'x', sourceId: 'prd' as never, location: { startLine: 1, uri: 'doc.md' as never } }
    const refB = { sourceId: 'prd' as never, location: { uri: 'doc.md' as never, startLine: 1 }, snippet: 'x' }
    const base = snapshot([node('n1', { metadata: { sourceReferences: [refA] } })])
    const { diff } = previewProposal(base, [
      {
        operation: 'updateNode',
        nodeId: 'n1' as NodeId,
        patch: { metadata: { sourceReferences: [refB] } },
      },
    ])
    expect(diff.nodes.has('n1' as NodeId)).toBe(false)
  })

  it('handles a mixed proposal across all three change kinds', () => {
    const base = snapshot([node('keep'), node('drop'), node('mod', { name: 'before' })])
    const { diff } = previewProposal(base, [
      { operation: 'addNode', payload: { id: 'new' as NodeId, type: 'command' as NodeTypeId, name: 'new', status: 'draft' as NodeStatus } },
      { operation: 'removeNode', nodeId: 'drop' as NodeId },
      { operation: 'updateNode', nodeId: 'mod' as NodeId, patch: { name: 'after' } },
    ])
    expect(diff.nodes.get('keep' as NodeId)).toBeUndefined()
    expect(diff.nodes.get('new' as NodeId)).toBe('added')
    expect(diff.nodes.get('drop' as NodeId)).toBe('removed')
    expect(diff.nodes.get('mod' as NodeId)).toBe('updated')
  })

  it('classifies edge operations symmetrically', () => {
    const base = snapshot(
      [node('a'), node('b'), node('c')],
      [edge('keep', 'a', 'b'), edge('drop', 'b', 'c')],
    )
    const { diff } = previewProposal(base, [
      { operation: 'addEdge', payload: { id: 'new' as EdgeId, type: 'contains' as EdgeTypeId, fromNodeId: 'a' as NodeId, toNodeId: 'c' as NodeId } },
      { operation: 'removeEdge', edgeId: 'drop' as EdgeId },
    ])
    expect(diff.edges.get('keep' as EdgeId)).toBeUndefined()
    expect(diff.edges.get('new' as EdgeId)).toBe('added')
    expect(diff.edges.get('drop' as EdgeId)).toBe('removed')
  })

  it('returns an empty diff when no operations are supplied', () => {
    const base = snapshot([node('n1')])
    const { snapshot: next, diff } = previewProposal(base, [])
    expect(next.nodes).toEqual(base.nodes)
    expect(diff.nodes.size).toBe(0)
    expect(diff.edges.size).toBe(0)
  })
})
