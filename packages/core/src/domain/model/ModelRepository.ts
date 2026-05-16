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
  findNodes: (workspaceId: WorkspaceId, filter?: GraphNodeFilter) => Promise<GraphNode[]>
  getNode: (workspaceId: WorkspaceId, nodeId: NodeId) => Promise<GraphNode>
  scopeOf: (workspaceId: WorkspaceId, nodeId: NodeId, depth: number) => Promise<ModelSnapshot>
  listEdges: (workspaceId: WorkspaceId, filter?: GraphEdgeFilter) => Promise<GraphEdge[]>
}
