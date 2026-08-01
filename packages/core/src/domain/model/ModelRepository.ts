import type {
  GraphEdge,
  GraphEdgeFilter,
  GraphNode,
  GraphNodeFilter,
  GraphOperation,
  ModelSnapshot,
  NodeId,
  WorkspaceId,
} from '@braidhq/schema'

export interface ModelRepository {
  load: (workspaceId: WorkspaceId) => Promise<ModelSnapshot>
  applyOperations: (workspaceId: WorkspaceId, operations: GraphOperation[]) => Promise<void>
  getNode: (workspaceId: WorkspaceId, nodeId: NodeId) => Promise<GraphNode>
  listNodes: (workspaceId: WorkspaceId, filter?: GraphNodeFilter) => Promise<GraphNode[]>
  listEdges: (workspaceId: WorkspaceId, filter?: GraphEdgeFilter) => Promise<GraphEdge[]>
  scopeOf: (workspaceId: WorkspaceId, nodeId: NodeId, depth: number) => Promise<ModelSnapshot>
  /** Optional graceful-shutdown hook for implementations holding native resources (file locks, native handles). Idempotent. */
  close?: () => Promise<void>
}
