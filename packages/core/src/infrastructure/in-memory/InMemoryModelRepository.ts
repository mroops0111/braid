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
import type { ModelRepository } from '../../domain/model/ModelRepository.js'
import { NotFoundError } from '../../domain/errors.js'
import { applyEdgeFilter, applyNodeFilter } from '../../domain/model/graphFilters.js'
import { Model } from '../../domain/model/Model.js'

export class InMemoryModelRepository implements ModelRepository {
  private readonly models = new Map<WorkspaceId, Model>()

  async load(workspaceId: WorkspaceId): Promise<ModelSnapshot> {
    return this.modelFor(workspaceId).toSnapshot()
  }

  async applyOperations(workspaceId: WorkspaceId, operations: GraphOperation[]): Promise<void> {
    this.modelFor(workspaceId).applyOperations(operations)
  }

  async listNodes(workspaceId: WorkspaceId, filter?: GraphNodeFilter): Promise<GraphNode[]> {
    const nodes = this.modelFor(workspaceId).toSnapshot().nodes
    return applyNodeFilter(nodes, filter)
  }

  async getNode(workspaceId: WorkspaceId, nodeId: NodeId): Promise<GraphNode> {
    const node = this.modelFor(workspaceId).findNode(nodeId)
    if (!node)
      throw new NotFoundError(`Node "${nodeId}" not found in workspace "${workspaceId}"`)
    return node
  }

  async scopeOf(workspaceId: WorkspaceId, nodeId: NodeId, depth: number): Promise<ModelSnapshot> {
    const model = this.modelFor(workspaceId)
    const seed = model.findNode(nodeId)
    if (!seed)
      throw new NotFoundError(`Node "${nodeId}" not found in workspace "${workspaceId}"`)
    const snapshot = model.toSnapshot()
    const visited = new Set<NodeId>([nodeId])
    let frontier: NodeId[] = [nodeId]
    for (let hop = 0; hop < depth; hop += 1) {
      const next: NodeId[] = []
      for (const edge of snapshot.edges) {
        if (frontier.includes(edge.fromNodeId) && !visited.has(edge.toNodeId)) {
          visited.add(edge.toNodeId)
          next.push(edge.toNodeId)
        }
        if (frontier.includes(edge.toNodeId) && !visited.has(edge.fromNodeId)) {
          visited.add(edge.fromNodeId)
          next.push(edge.fromNodeId)
        }
      }
      if (next.length === 0)
        break
      frontier = next
    }
    return {
      nodes: snapshot.nodes.filter(node => visited.has(node.id)),
      edges: snapshot.edges.filter(edge => visited.has(edge.fromNodeId) && visited.has(edge.toNodeId)),
    }
  }

  async listEdges(workspaceId: WorkspaceId, filter?: GraphEdgeFilter): Promise<GraphEdge[]> {
    const edges = this.modelFor(workspaceId).toSnapshot().edges
    return applyEdgeFilter(edges, filter)
  }

  private modelFor(workspaceId: WorkspaceId): Model {
    const cachedModel = this.models.get(workspaceId)
    if (cachedModel)
      return cachedModel
    const newModel = new Model()
    this.models.set(workspaceId, newModel)
    return newModel
  }
}
