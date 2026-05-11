import { describe, expect, it } from 'vitest'
import {
  Embedding,
  GraphEdge,
  GraphEdgeUpdate,
  GraphNode,
  GraphNodeFilter,
  GraphNodeUpdate,
  ModelSnapshot,
  NewGraphEdge,
  NewGraphNode,
} from '../src/index.js'

const isoTimestamp = '2026-05-09T12:00:00+08:00'

describe('embedding', () => {
  it('parses a vector + model id + timestamp', () => {
    const embedding = Embedding.parse({
      vector: [0.1, 0.2, 0.3],
      modelId: 'voyage-3',
      createdAt: isoTimestamp,
    })
    expect(embedding.vector).toHaveLength(3)
  })
  it('rejects empty model id', () => {
    expect(
      Embedding.safeParse({ vector: [], modelId: '', createdAt: isoTimestamp }).success,
    ).toBe(false)
  })
})

describe('newGraphNode', () => {
  it('defaults status to draft', () => {
    const node = NewGraphNode.parse({ type: 'command', name: 'voidTask' })
    expect(node.status).toBe('draft')
  })
  it('rejects empty name', () => {
    expect(NewGraphNode.safeParse({ type: 'command', name: '' }).success).toBe(false)
  })
  it('accepts optional embedding', () => {
    const node = NewGraphNode.parse({
      type: 'command',
      name: 'voidTask',
      embedding: { vector: [0.1], modelId: 'voyage-3', createdAt: isoTimestamp },
    })
    expect(node.embedding?.vector).toHaveLength(1)
  })
})

describe('graphNode', () => {
  it('requires id and metadata', () => {
    const node = GraphNode.parse({
      id: 'n-1',
      type: 'command',
      name: 'voidTask',
      status: 'draft',
      metadata: { sourceReferences: [] },
    })
    expect(node.id).toBe('n-1')
  })
  it('rejects unknown status', () => {
    const result = GraphNode.safeParse({
      id: 'n-1',
      type: 'command',
      name: 'voidTask',
      status: 'approved',
      metadata: { sourceReferences: [] },
    })
    expect(result.success).toBe(false)
  })
})

describe('graphEdge', () => {
  it('parses a complete edge', () => {
    const edge = GraphEdge.parse({
      id: 'e-1',
      type: 'contains',
      fromNodeId: 'n-1',
      toNodeId: 'n-2',
      metadata: { sourceReferences: [] },
    })
    expect(edge.fromNodeId).toBe('n-1')
  })
  it('newGraphEdge allows omitting id', () => {
    const edge = NewGraphEdge.parse({
      type: 'emits',
      fromNodeId: 'n-1',
      toNodeId: 'n-2',
    })
    expect(edge.id).toBeUndefined()
  })
})

describe('updates', () => {
  it('GraphNodeUpdate carries patch', () => {
    const update = GraphNodeUpdate.parse({ nodeId: 'n-1', patch: { name: 'newName' } })
    expect(update.patch.name).toBe('newName')
  })
  it('GraphEdgeUpdate carries patch', () => {
    const update = GraphEdgeUpdate.parse({ edgeId: 'e-1', patch: { type: 'triggers' } })
    expect(update.patch.type).toBe('triggers')
  })
})

describe('modelSnapshot', () => {
  it('round-trips empty graph', () => {
    expect(ModelSnapshot.parse({ nodes: [], edges: [] })).toEqual({ nodes: [], edges: [] })
  })
})

describe('graphNodeFilter', () => {
  it('accepts type + status filters', () => {
    const filter = GraphNodeFilter.parse({
      types: ['command', 'aggregate'],
      statuses: ['draft', 'unclear'],
    })
    expect(filter.types).toHaveLength(2)
  })
  it('all fields optional', () => {
    expect(GraphNodeFilter.parse({})).toEqual({})
  })
})
