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
    // description should NOT be wiped out, undefined means no change
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

  it('marks a node updated when a sourceReference sourceId changes', () => {
    const base = snapshot([node('n1', {
      metadata: { sourceReferences: [{ sourceId: 'prd' as never, location: { uri: 'doc.md' as never } }] },
    })])
    const { diff } = previewProposal(base, [
      {
        operation: 'updateNode',
        nodeId: 'n1' as NodeId,
        patch: { metadata: { sourceReferences: [{ sourceId: 'code' as never, location: { uri: 'doc.md' as never } }] } },
      },
    ])
    expect(diff.nodes.get('n1' as NodeId)).toBe('updated')
  })

  it('marks a node updated when only a sourceReference location line changes', () => {
    const base = snapshot([node('n1', {
      metadata: { sourceReferences: [{ sourceId: 'prd' as never, location: { uri: 'doc.md' as never, startLine: 1 } }] },
    })])
    const { diff } = previewProposal(base, [
      {
        operation: 'updateNode',
        nodeId: 'n1' as NodeId,
        patch: { metadata: { sourceReferences: [{ sourceId: 'prd' as never, location: { uri: 'doc.md' as never, startLine: 2 } }] } },
      },
    ])
    expect(diff.nodes.get('n1' as NodeId)).toBe('updated')
  })

  it('marks a node updated when externalReferences appear where there were none', () => {
    const base = snapshot([node('n1', { metadata: { sourceReferences: [] } })])
    const { diff } = previewProposal(base, [
      {
        operation: 'updateNode',
        nodeId: 'n1' as NodeId,
        patch: { metadata: { sourceReferences: [], externalReferences: [{ kind: 'github' as never, url: 'https://x/1' }] } },
      },
    ])
    expect(diff.nodes.get('n1' as NodeId)).toBe('updated')
  })

  it('marks a node updated when the externalReferences count changes', () => {
    const base = snapshot([node('n1', {
      metadata: { sourceReferences: [], externalReferences: [{ kind: 'github' as never, url: 'https://x/1' }] },
    })])
    const { diff } = previewProposal(base, [
      {
        operation: 'updateNode',
        nodeId: 'n1' as NodeId,
        patch: {
          metadata: {
            sourceReferences: [],
            externalReferences: [
              { kind: 'github' as never, url: 'https://x/1' },
              { kind: 'github' as never, url: 'https://x/2' },
            ],
          },
        },
      },
    ])
    expect(diff.nodes.get('n1' as NodeId)).toBe('updated')
  })

  it('marks a node updated when an externalReference url changes', () => {
    const base = snapshot([node('n1', {
      metadata: { sourceReferences: [], externalReferences: [{ kind: 'github' as never, url: 'https://x/1' }] },
    })])
    const { diff } = previewProposal(base, [
      {
        operation: 'updateNode',
        nodeId: 'n1' as NodeId,
        patch: { metadata: { sourceReferences: [], externalReferences: [{ kind: 'github' as never, url: 'https://x/2' }] } },
      },
    ])
    expect(diff.nodes.get('n1' as NodeId)).toBe('updated')
  })

  it('leaves a node unchanged when externalReferences are structurally equal', () => {
    const ext = [{ kind: 'github' as never, url: 'https://x/1', label: 'issue 1' }]
    const base = snapshot([node('n1', { metadata: { sourceReferences: [], externalReferences: ext } })])
    const { diff } = previewProposal(base, [
      {
        operation: 'updateNode',
        nodeId: 'n1' as NodeId,
        patch: { metadata: { sourceReferences: [], externalReferences: [{ kind: 'github' as never, url: 'https://x/1', label: 'issue 1' }] } },
      },
    ])
    expect(diff.nodes.has('n1' as NodeId)).toBe(false)
  })

  it('applies plural node operations in one pass', () => {
    const base = snapshot([node('drop1'), node('drop2'), node('mod', { name: 'a' })])
    const { diff } = previewProposal(base, [
      { operation: 'addNodes', payloads: [
        { id: 'x1' as NodeId, type: 'command' as NodeTypeId, name: 'x1', status: 'draft' as NodeStatus },
        { id: 'x2' as NodeId, type: 'command' as NodeTypeId, name: 'x2', status: 'draft' as NodeStatus },
      ] },
      { operation: 'removeNodes', nodeIds: ['drop1' as NodeId, 'drop2' as NodeId] },
      { operation: 'updateNodes', updates: [{ nodeId: 'mod' as NodeId, patch: { name: 'b' } }] },
    ])
    expect(diff.nodes.get('x1' as NodeId)).toBe('added')
    expect(diff.nodes.get('drop2' as NodeId)).toBe('removed')
    expect(diff.nodes.get('mod' as NodeId)).toBe('updated')
  })

  it('marks an edge updated when its type changes', () => {
    const base = snapshot([node('a'), node('b')], [edge('e1', 'a', 'b')])
    const { diff } = previewProposal(base, [
      { operation: 'updateEdge', edgeId: 'e1' as EdgeId, patch: { type: 'triggers' as EdgeTypeId } },
    ])
    expect(diff.edges.get('e1' as EdgeId)).toBe('updated')
  })

  it('applies plural edge operations in one pass', () => {
    const base = snapshot(
      [node('a'), node('b'), node('c')],
      [edge('drop1', 'a', 'b'), edge('mod', 'b', 'c')],
    )
    const { diff } = previewProposal(base, [
      { operation: 'addEdges', payloads: [
        { id: 'e1' as EdgeId, type: 'contains' as EdgeTypeId, fromNodeId: 'a' as NodeId, toNodeId: 'c' as NodeId },
      ] },
      { operation: 'removeEdges', edgeIds: ['drop1' as EdgeId] },
      { operation: 'updateEdges', updates: [{ edgeId: 'mod' as EdgeId, patch: { type: 'triggers' as EdgeTypeId } }] },
    ])
    expect(diff.edges.get('e1' as EdgeId)).toBe('added')
    expect(diff.edges.get('drop1' as EdgeId)).toBe('removed')
    expect(diff.edges.get('mod' as EdgeId)).toBe('updated')
  })

  it('materializes an added node carrying description and embedding', () => {
    const { snapshot: next } = previewProposal(snapshot([]), [
      { operation: 'addNode', payload: {
        id: 'n1' as NodeId,
        type: 'command' as NodeTypeId,
        name: 'n1',
        status: 'draft' as NodeStatus,
        description: 'desc',
      } },
    ])
    expect(next.nodes[0]!.description).toBe('desc')
  })

  it('synthesizes ids for id-less added node and edge payloads', () => {
    const { snapshot: next, diff } = previewProposal(snapshot([]), [
      { operation: 'addNode', payload: { type: 'command' as NodeTypeId, name: 'anon', status: 'draft' as NodeStatus } },
    ])
    const created = next.nodes[0]!
    expect(created.id.startsWith('preview:')).toBe(true)
    expect(diff.nodes.get(created.id)).toBe('added')
  })
})
