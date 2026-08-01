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
    let nodes = this.modelFor(workspaceId).toSnapshot().nodes
    if (filter?.types && filter.types.length > 0) {
      const types = filter.types
      nodes = nodes.filter(node => types.includes(node.type))
    }
    if (filter?.statuses && filter.statuses.length > 0) {
      const statuses = filter.statuses
      nodes = nodes.filter(node => statuses.includes(node.status))
    }
    if (filter?.nameContains) {
      const needle = filter.nameContains.toLowerCase()
      nodes = nodes.filter(node => node.name.toLowerCase().includes(needle))
    }
    return nodes
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
    let edges = this.modelFor(workspaceId).toSnapshot().edges
    if (filter?.types && filter.types.length > 0) {
      const types = filter.types
      edges = edges.filter(edge => types.includes(edge.type))
    }
    if (filter?.fromNodeId !== undefined) {
      const fromId = filter.fromNodeId
      edges = edges.filter(edge => edge.fromNodeId === fromId)
    }
    if (filter?.toNodeId !== undefined) {
      const toId = filter.toNodeId
      edges = edges.filter(edge => edge.toNodeId === toId)
    }
    return edges
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
