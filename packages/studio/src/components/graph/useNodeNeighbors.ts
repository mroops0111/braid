import type { GraphEdge, GraphNode, NodeId } from '@braidhq/schema'
import { useMemo } from 'react'

export interface NodeNeighbors {
  readonly nodesById: ReadonlyMap<NodeId, GraphNode>
  readonly incoming: readonly GraphEdge[]
  readonly outgoing: readonly GraphEdge[]
}

/**
 * Derived data used by the shared `NodeDetailPanel`. Memoised on
 * `(nodes, edges, selectedNodeId)` so big snapshots don't rebuild the
 * id map per render and the canvas / table consumers stay in sync.
 */
export function useNodeNeighbors(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  selectedNodeId: NodeId | null,
): NodeNeighbors {
  const nodesById = useMemo(
    () => new Map<NodeId, GraphNode>(nodes.map(n => [n.id, n])),
    [nodes],
  )
  const incoming = useMemo(
    () => selectedNodeId ? edges.filter(e => e.toNodeId === selectedNodeId) : [],
    [edges, selectedNodeId],
  )
  const outgoing = useMemo(
    () => selectedNodeId ? edges.filter(e => e.fromNodeId === selectedNodeId) : [],
    [edges, selectedNodeId],
  )
  return { nodesById, incoming, outgoing }
}
