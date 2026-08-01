import type { EdgeId, EdgeTypeId, GraphEdge, GraphNode, NodeId, NodeTypeId } from '@braidhq/schema'

/** Construct a GraphNode fixture, a draft aggregate named by its id. Override any field per test. */
export function makeNode(id: string, overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: id as NodeId,
    type: 'aggregate' as NodeTypeId,
    name: id,
    status: 'draft',
    metadata: { sourceReferences: [] },
    ...overrides,
  }
}

/** Construct a GraphEdge fixture, a contains edge between two node ids. Override any field per test. */
export function makeEdge(id: string, from: string, to: string, overrides: Partial<GraphEdge> = {}): GraphEdge {
  return {
    id: id as EdgeId,
    type: 'contains' as EdgeTypeId,
    fromNodeId: from as NodeId,
    toNodeId: to as NodeId,
    metadata: { sourceReferences: [] },
    ...overrides,
  }
}
