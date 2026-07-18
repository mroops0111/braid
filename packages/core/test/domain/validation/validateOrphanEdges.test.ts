import type { EdgeId, EdgeTypeId, ModelSnapshot, NodeId, NodeStatus, NodeTypeId } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { validateOrphanEdges } from '../../../src/domain/validation/validateOrphanEdges.js'

const aggregate = 'aggregate' as NodeTypeId
const draft = 'draft' as NodeStatus
const contains = 'contains' as EdgeTypeId

function snapshot(nodes: ModelSnapshot['nodes'], edges: ModelSnapshot['edges']): ModelSnapshot {
  return { nodes, edges }
}

describe('validateOrphanEdges', () => {
  it('passes when every edge endpoint exists', () => {
    const issues = validateOrphanEdges(snapshot(
      [
        { id: 'a' as NodeId, type: aggregate, name: 'A', status: draft, metadata: { sourceReferences: [] } },
        { id: 'b' as NodeId, type: aggregate, name: 'B', status: draft, metadata: { sourceReferences: [] } },
      ],
      [{ id: 'e1' as EdgeId, type: contains, fromNodeId: 'a' as NodeId, toNodeId: 'b' as NodeId, metadata: { sourceReferences: [] } }],
    ))
    expect(issues).toEqual([])
  })

  it('emits error when source node is missing', () => {
    const issues = validateOrphanEdges(snapshot(
      [{ id: 'b' as NodeId, type: aggregate, name: 'B', status: draft, metadata: { sourceReferences: [] } }],
      [{ id: 'e1' as EdgeId, type: contains, fromNodeId: 'ghost' as NodeId, toNodeId: 'b' as NodeId, metadata: { sourceReferences: [] } }],
    ))
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ code: 'edge.dangling-source', edgeId: 'e1' })
  })

  it('emits error when target node is missing', () => {
    const issues = validateOrphanEdges(snapshot(
      [{ id: 'a' as NodeId, type: aggregate, name: 'A', status: draft, metadata: { sourceReferences: [] } }],
      [{ id: 'e1' as EdgeId, type: contains, fromNodeId: 'a' as NodeId, toNodeId: 'ghost' as NodeId, metadata: { sourceReferences: [] } }],
    ))
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ code: 'edge.dangling-target', edgeId: 'e1' })
  })

  it('emits both when both endpoints are missing', () => {
    const issues = validateOrphanEdges(snapshot(
      [],
      [{ id: 'e1' as EdgeId, type: contains, fromNodeId: 'x' as NodeId, toNodeId: 'y' as NodeId, metadata: { sourceReferences: [] } }],
    ))
    expect(issues.map(i => i.code).sort()).toEqual(['edge.dangling-source', 'edge.dangling-target'])
  })
})
