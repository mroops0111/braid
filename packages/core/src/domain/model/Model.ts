import type {
  EdgeId,
  GraphEdge,
  GraphEdgeCreate,
  GraphNode,
  GraphNodeCreate,
  GraphOperation,
  ModelSnapshot,
  NodeId,
} from '@braidhq/schema'
import { ConflictError, NotFoundError } from '../errors.js'
import { newEdgeId, newNodeId } from '../ids.js'

interface MutableModelState {
  nodes: Map<NodeId, GraphNode>
  edges: Map<EdgeId, GraphEdge>
}

/**
 * The knowledge graph as one consistency boundary.
 * Parts are Graph* like GraphNode and GraphEdge, the whole and its handlers are Model*.
 */
export class Model {
  private state: MutableModelState

  constructor(snapshot?: ModelSnapshot) {
    this.state = {
      nodes: new Map((snapshot?.nodes ?? []).map(node => [node.id, node])),
      edges: new Map((snapshot?.edges ?? []).map(edge => [edge.id, edge])),
    }
  }

  static preview(snapshot: ModelSnapshot, operations: readonly GraphOperation[]): ModelSnapshot {
    const model = new Model(snapshot)
    model.applyOperations([...operations])
    return model.toSnapshot()
  }

  addNode(payload: GraphNodeCreate): NodeId {
    const node = this.materializeNode(payload)
    this.applyValidatedAdd(this.state, node)
    return node.id
  }

  addNodes(payloads: GraphNodeCreate[]): NodeId[] {
    const nodes = payloads.map(payload => this.materializeNode(payload))
    const draft = this.cloneState()
    for (const node of nodes) this.applyValidatedAdd(draft, node)
    this.state = draft
    return nodes.map(node => node.id)
  }

  removeNode(nodeId: NodeId): void {
    this.applyOperations([{ operation: 'removeNode', nodeId }])
  }

  removeNodes(nodeIds: NodeId[]): void {
    this.applyOperations([{ operation: 'removeNodes', nodeIds }])
  }

  updateNode(nodeId: NodeId, patch: Partial<GraphNode>): void {
    this.applyOperations([{ operation: 'updateNode', nodeId, patch }])
  }

  addEdge(payload: GraphEdgeCreate): EdgeId {
    const edge = this.materializeEdge(payload)
    this.applyValidatedAddEdge(this.state, edge)
    return edge.id
  }

  applyOperations(operations: GraphOperation[]): void {
    const draft = this.cloneState()
    for (const operation of operations) this.applyOperation(draft, operation)
    this.state = draft
  }

  findNode(nodeId: NodeId): GraphNode | undefined {
    return this.state.nodes.get(nodeId)
  }

  findEdgesFromNode(nodeId: NodeId): GraphEdge[] {
    return [...this.state.edges.values()].filter(edge => edge.fromNodeId === nodeId)
  }

  toSnapshot(): ModelSnapshot {
    return {
      nodes: [...this.state.nodes.values()],
      edges: [...this.state.edges.values()],
    }
  }

  private cloneState(): MutableModelState {
    return {
      nodes: new Map(this.state.nodes),
      edges: new Map(this.state.edges),
    }
  }

  private materializeNode(payload: GraphNodeCreate): GraphNode {
    return {
      id: payload.id ?? newNodeId(),
      type: payload.type,
      name: payload.name,
      description: payload.description,
      status: payload.status ?? 'draft',
      metadata: payload.metadata ?? { sourceReferences: [] },
      embedding: payload.embedding,
    }
  }

  private materializeEdge(payload: GraphEdgeCreate): GraphEdge {
    return {
      id: payload.id ?? newEdgeId(),
      type: payload.type,
      fromNodeId: payload.fromNodeId,
      toNodeId: payload.toNodeId,
      metadata: payload.metadata ?? { sourceReferences: [] },
    }
  }

  private applyValidatedAdd(state: MutableModelState, node: GraphNode): void {
    if (state.nodes.has(node.id)) {
      throw new ConflictError(`Node id "${node.id}" already exists`)
    }
    state.nodes.set(node.id, node)
  }

  private applyValidatedRemove(state: MutableModelState, nodeId: NodeId): void {
    if (!state.nodes.has(nodeId)) {
      throw new NotFoundError(`Node "${nodeId}" not found`)
    }
    state.nodes.delete(nodeId)
    for (const [edgeId, edge] of state.edges) {
      if (edge.fromNodeId === nodeId || edge.toNodeId === nodeId) {
        state.edges.delete(edgeId)
      }
    }
  }

  private applyValidatedUpdate(
    state: MutableModelState,
    nodeId: NodeId,
    patch: Partial<GraphNode>,
  ): void {
    const existingNode = state.nodes.get(nodeId)
    if (!existingNode) {
      throw new NotFoundError(`Node "${nodeId}" not found`)
    }
    state.nodes.set(nodeId, { ...existingNode, ...patch, id: existingNode.id })
  }

  private applyValidatedAddEdge(state: MutableModelState, edge: GraphEdge): void {
    if (!state.nodes.has(edge.fromNodeId)) {
      throw new NotFoundError(`Edge source "${edge.fromNodeId}" not found`)
    }
    if (!state.nodes.has(edge.toNodeId)) {
      throw new NotFoundError(`Edge target "${edge.toNodeId}" not found`)
    }
    if (state.edges.has(edge.id)) {
      throw new ConflictError(`Edge id "${edge.id}" already exists`)
    }
    state.edges.set(edge.id, edge)
  }

  private applyValidatedRemoveEdge(state: MutableModelState, edgeId: EdgeId): void {
    if (!state.edges.has(edgeId)) {
      throw new NotFoundError(`Edge "${edgeId}" not found`)
    }
    state.edges.delete(edgeId)
  }

  private applyValidatedUpdateEdge(
    state: MutableModelState,
    edgeId: EdgeId,
    patch: Partial<GraphEdge>,
  ): void {
    const existingEdge = state.edges.get(edgeId)
    if (!existingEdge) {
      throw new NotFoundError(`Edge "${edgeId}" not found`)
    }
    state.edges.set(edgeId, { ...existingEdge, ...patch, id: existingEdge.id })
  }

  private applyOperation(state: MutableModelState, operation: GraphOperation): void {
    switch (operation.operation) {
      case 'addNode':
        this.applyValidatedAdd(state, this.materializeNode(operation.payload))
        return
      case 'addNodes':
        for (const payload of operation.payloads) {
          this.applyValidatedAdd(state, this.materializeNode(payload))
        }
        return
      case 'removeNode':
        this.applyValidatedRemove(state, operation.nodeId)
        return
      case 'removeNodes':
        for (const nodeId of operation.nodeIds) this.applyValidatedRemove(state, nodeId)
        return
      case 'updateNode':
        this.applyValidatedUpdate(state, operation.nodeId, operation.patch as Partial<GraphNode>)
        return
      case 'updateNodes':
        for (const update of operation.updates) {
          this.applyValidatedUpdate(state, update.nodeId, update.patch as Partial<GraphNode>)
        }
        return
      case 'addEdge':
        this.applyValidatedAddEdge(state, this.materializeEdge(operation.payload))
        return
      case 'addEdges':
        for (const payload of operation.payloads) {
          this.applyValidatedAddEdge(state, this.materializeEdge(payload))
        }
        return
      case 'removeEdge':
        this.applyValidatedRemoveEdge(state, operation.edgeId)
        return
      case 'removeEdges':
        for (const edgeId of operation.edgeIds) this.applyValidatedRemoveEdge(state, edgeId)
        return
      case 'updateEdge':
        this.applyValidatedUpdateEdge(state, operation.edgeId, operation.patch as Partial<GraphEdge>)
        return
      case 'updateEdges':
        for (const update of operation.updates) {
          this.applyValidatedUpdateEdge(state, update.edgeId, update.patch as Partial<GraphEdge>)
        }
        return
      default: {
        const exhaustive: never = operation
        throw new Error(`Unhandled GraphOperation: ${JSON.stringify(exhaustive)}`)
      }
    }
  }
}
