import type { GraphEdge, GraphNode } from '@telos/schema'
import type { Edge, Node } from '@xyflow/react'
import dagre from '@dagrejs/dagre'
import { useMemo } from 'react'

const NODE_WIDTH = 200
const NODE_HEIGHT = 64

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
  // Top-down for DDD: boundedContext sits at the top, aggregates / commands
  // / events / rules descend. Tight intra-rank spacing because cards are
  // small and the canvas is dense.
  graph.setGraph({ rankdir: 'TB', ranksep: 56, nodesep: 24, edgesep: 12 })

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

  const flowEdges: Edge<EdgeCardData>[] = edges.map(edge => ({
    id: edge.id,
    source: edge.fromNodeId,
    target: edge.toNodeId,
    type: 'smoothstep',
    label: edge.type,
    data: { edge },
  }))

  return { nodes: flowNodes, edges: flowEdges }
}
