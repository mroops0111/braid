import type { DriftIssueId, SourceId } from '../src/index.js'
import { T0 as isoTimestamp } from '@braidhq/test-utils'
import { describe, expect, it } from 'vitest'

import {
  DriftIssue,
  DriftSeverity,
  Embedding,
  GraphEdge,
  GraphEdgeCreate,
  GraphEdgeFilter,
  GraphEdgeUpdate,
  GraphNode,
  GraphNodeCreate,
  GraphNodeFilter,
  GraphNodeUpdate,
  ModelSnapshot,
} from '../src/index.js'

function sourceRef(uri: string) {
  return {
    sourceId: 'src' as SourceId,
    location: { uri },
  }
}

describe('Embedding', () => {
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

describe('GraphNodeCreate', () => {
  it('defaults status to draft', () => {
    const node = GraphNodeCreate.parse({ type: 'command', name: 'voidTask' })
    expect(node.status).toBe('draft')
  })
  it('rejects empty name', () => {
    expect(GraphNodeCreate.safeParse({ type: 'command', name: '' }).success).toBe(false)
  })
  it('accepts optional embedding', () => {
    const node = GraphNodeCreate.parse({
      type: 'command',
      name: 'voidTask',
      embedding: { vector: [0.1], modelId: 'voyage-3', createdAt: isoTimestamp },
    })
    expect(node.embedding?.vector).toHaveLength(1)
  })
})

describe('GraphNode', () => {
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

describe('GraphEdge', () => {
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
    const edge = GraphEdgeCreate.parse({
      type: 'emits',
      fromNodeId: 'n-1',
      toNodeId: 'n-2',
    })
    expect(edge.id).toBeUndefined()
  })
})

describe('Updates', () => {
  it('GraphNodeUpdate carries patch', () => {
    const update = GraphNodeUpdate.parse({ nodeId: 'n-1', patch: { name: 'newName' } })
    expect(update.patch.name).toBe('newName')
  })
  it('GraphEdgeUpdate carries patch', () => {
    const update = GraphEdgeUpdate.parse({ edgeId: 'e-1', patch: { type: 'triggers' } })
    expect(update.patch.type).toBe('triggers')
  })
})

describe('ModelSnapshot', () => {
  it('round-trips empty graph', () => {
    expect(ModelSnapshot.parse({ nodes: [], edges: [] })).toEqual({ nodes: [], edges: [] })
  })
})

describe('GraphNodeFilter', () => {
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

describe('GraphEdgeFilter', () => {
  it('accepts type plus endpoint filters', () => {
    const filter = GraphEdgeFilter.parse({ types: ['contains'], fromNodeId: 'n-1', toNodeId: 'n-2' })
    expect(filter.fromNodeId).toBe('n-1')
  })
  it('all fields optional', () => {
    expect(GraphEdgeFilter.parse({})).toEqual({})
  })
})

describe('DriftSeverity', () => {
  it('accepts error / warning / info', () => {
    expect(DriftSeverity.parse('error')).toBe('error')
    expect(DriftSeverity.parse('warning')).toBe('warning')
    expect(DriftSeverity.parse('info')).toBe('info')
  })
  it('rejects unknown severity', () => {
    expect(DriftSeverity.safeParse('fatal').success).toBe(false)
  })
})

describe('DriftIssue', () => {
  const valid = {
    id: 'd-1' as DriftIssueId,
    description: 'Intent says cap 50, code allows 99',
    severity: 'error' as const,
    sourceReferences: [sourceRef('intent/cart.md'), sourceRef('apps/api/cart.ts')],
    raisedAt: '2026-05-23T00:00:00.000Z',
  }

  it('parses minimal valid drift issue', () => {
    expect(DriftIssue.parse(valid)).toMatchObject({ id: 'd-1', severity: 'error' })
  })

  it('requires at least two sourceReferences (drift is by definition a 2-source comparison)', () => {
    const oneRef = { ...valid, sourceReferences: [sourceRef('intent/cart.md')] }
    expect(DriftIssue.safeParse(oneRef).success).toBe(false)
  })

  it('rejects empty description', () => {
    expect(DriftIssue.safeParse({ ...valid, description: '' }).success).toBe(false)
  })
})
