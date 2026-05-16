import type { GraphEdge, GraphNode } from '@braidhq/schema'
import type { Edge, Node } from '@xyflow/react'
import dagre from '@dagrejs/dagre'
import { useMemo } from 'react'

const NODE_WIDTH = 200
// Card height varies with the description subtitle. Reserve enough
// vertical space for the longer case so edges going around cards have
// room. Real cards may render shorter; that just makes the gap larger,
// which is fine for readability.
const NODE_HEIGHT = 92

export interface NodeCardData extends Record<string, unknown> {
  node: GraphNode
}

export interface EdgeCardData extends Record<string, unknown> {
  edge: GraphEdge
}

export type NodeCardNode = Node<NodeCardData, 'card'>

export interface LaidOutGraph {
  nodes: NodeCardNode[]
  edges: Edge<EdgeCardData>[]
}

/**
 * Memoised dagre layout. Recomputes when the node or edge ids change so an
 * in-place metadata edit (description, status) doesn't trigger a re-layout
 * and re-pan; adding / removing a node does.
 */
export function useGraphLayout(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): LaidOutGraph {
  const nodeKey = nodes.map(n => n.id).join('|')
  const edgeKey = edges.map(e => `${e.id}:${e.fromNodeId}->${e.toNodeId}`).join('|')

  return useMemo(() => layout(nodes, edges), [nodeKey, edgeKey])
}

function layout(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): LaidOutGraph {
  const graph = new dagre.graphlib.Graph()
  graph.setDefaultEdgeLabel(() => ({}))
  // Top-down for DDD: boundedContext sits at the top; aggregates,
  // commands, events, rules descend from it. Spacing tuned so edge
  // labels (placed at the segment midpoint by react-flow) land in the
  // gap between rows rather than overlapping the cards on either side.
  //   ranksep: vertical gap between ranks  — wide enough to fit two
  //            stacked edge labels with their background pills.
  //   nodesep: horizontal gap between sibling cards on the same rank.
  //   edgesep: lateral gap between parallel edges that share endpoints.
  graph.setGraph({ rankdir: 'TB', ranksep: 110, nodesep: 64, edgesep: 24 })

  for (const node of nodes)
    graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT })

  for (const edge of edges) {
    // Dagre throws on edges referencing missing nodes; skip them silently here
    // since OrphanEdgeValidator surfaces them as a validation issue elsewhere.
    if (graph.node(edge.fromNodeId) && graph.node(edge.toNodeId))
      graph.setEdge(edge.fromNodeId, edge.toNodeId)
  }

  dagre.layout(graph)

  const flowNodes: NodeCardNode[] = nodes.map((node) => {
    const positioned = graph.node(node.id)
    return {
      id: node.id,
      type: 'card',
      position: {
        x: positioned.x - NODE_WIDTH / 2,
        y: positioned.y - NODE_HEIGHT / 2,
      },
      data: { node },
    }
  })

  // Default edge type (bezier) — the curve handles densely-fanned
  // edges out of a single source much better than smoothstep's
  // right-angle routing, which shared vertical segments and made the
  // canvas read as overlapping pipes.
  const flowEdges: Edge<EdgeCardData>[] = edges.map(edge => ({
    id: edge.id,
    source: edge.fromNodeId,
    target: edge.toNodeId,
    label: edge.type,
    data: { edge },
  }))

  return { nodes: flowNodes, edges: flowEdges }
}
