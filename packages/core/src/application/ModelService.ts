import type {
  GraphEdge,
  GraphEdgeFilter,
  GraphNode,
  GraphNodeFilter,
  ModelSnapshot,
  NodeId,
  WorkspaceId,
} from '@braidhq/schema'
import type { ModelRepository } from '../domain/model/ModelRepository.js'

export interface ModelServiceDeps {
  modelRepository: ModelRepository
}

export class ModelService {
  constructor(private readonly deps: ModelServiceDeps) {}

  async getSnapshot(workspaceId: WorkspaceId): Promise<ModelSnapshot> {
    return this.deps.modelRepository.load(workspaceId)
  }

  async listNodes(workspaceId: WorkspaceId, filter?: GraphNodeFilter): Promise<GraphNode[]> {
    return this.deps.modelRepository.listNodes(workspaceId, filter)
  }

  async getNode(workspaceId: WorkspaceId, nodeId: NodeId): Promise<GraphNode> {
    return this.deps.modelRepository.getNode(workspaceId, nodeId)
  }

  async scopeOf(workspaceId: WorkspaceId, nodeId: NodeId, depth: number): Promise<ModelSnapshot> {
    return this.deps.modelRepository.scopeOf(workspaceId, nodeId, depth)
  }

  async listEdges(workspaceId: WorkspaceId, filter?: GraphEdgeFilter): Promise<GraphEdge[]> {
    return this.deps.modelRepository.listEdges(workspaceId, filter)
  }
}
