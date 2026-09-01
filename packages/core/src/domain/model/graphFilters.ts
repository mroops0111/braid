import type { GraphEdge, GraphEdgeFilter, GraphNode, GraphNodeFilter } from '@braidhq/schema'

/**
 * Narrow a node list to a filter.
 *
 * Shared by every ModelRepository,
 * since each one holds the whole snapshot in memory before answering.
 * Two copies would let one backend drift into a different search.
 */
export function applyNodeFilter(nodes: readonly GraphNode[], filter?: GraphNodeFilter): GraphNode[] {
  let out = [...nodes]
  if (filter?.types?.length) {
    const types = filter.types
    out = out.filter(node => types.includes(node.type))
  }
  if (filter?.statuses?.length) {
    const statuses = filter.statuses
    out = out.filter(node => statuses.includes(node.status))
  }
  if (filter?.textContains) {
    const needle = filter.textContains.toLowerCase()
    // Name alone misses a node whose vocabulary lives in its description,
    // which is where most of a node's words actually are.
    out = out.filter(node =>
      node.name.toLowerCase().includes(needle)
      || (node.description?.toLowerCase().includes(needle) ?? false),
    )
  }
  return out
}

/** The same for edges, which match on type and endpoints alone. */
export function applyEdgeFilter(edges: readonly GraphEdge[], filter?: GraphEdgeFilter): GraphEdge[] {
  let out = [...edges]
  if (filter?.types?.length) {
    const types = filter.types
    out = out.filter(edge => types.includes(edge.type))
  }
  if (filter?.fromNodeId !== undefined) {
    const fromNodeId = filter.fromNodeId
    out = out.filter(edge => edge.fromNodeId === fromNodeId)
  }
  if (filter?.toNodeId !== undefined) {
    const toNodeId = filter.toNodeId
    out = out.filter(edge => edge.toNodeId === toNodeId)
  }
  return out
}
