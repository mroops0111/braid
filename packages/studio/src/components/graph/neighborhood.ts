import type { EdgeId, GraphEdge, NodeId } from '@braidhq/schema'

export interface Neighborhood {
  /** Selected node + every node connected to it by one edge. Includes the selection itself. */
  readonly neighbors: ReadonlySet<NodeId>
  /** Edges that touch the selection (either endpoint). */
  readonly incidentEdges: ReadonlySet<EdgeId>
}

const EMPTY: Neighborhood = {
  neighbors: new Set<NodeId>(),
  incidentEdges: new Set<EdgeId>(),
}

/**
 * One-hop neighborhood around `selectedNodeId`. Pure: same inputs always
 * yield equivalent sets. Returns empty sets when no node is selected so
 * consumers don't have to null-check.
 *
 * Consumers use this to dim or hide elements outside the neighborhood.
 * The selected node is included in `neighbors` so callers can write
 * `neighbors.has(id)` without special-casing the selection.
 */
export function computeNeighborhood(
  selectedNodeId: NodeId | null,
  edges: readonly GraphEdge[],
): Neighborhood {
  if (!selectedNodeId)
    return EMPTY
  const neighbors = new Set<NodeId>([selectedNodeId])
  const incidentEdges = new Set<EdgeId>()
  for (const edge of edges) {
    if (edge.fromNodeId === selectedNodeId || edge.toNodeId === selectedNodeId) {
      incidentEdges.add(edge.id)
      neighbors.add(edge.fromNodeId)
      neighbors.add(edge.toNodeId)
    }
  }
  return { neighbors, incidentEdges }
}
