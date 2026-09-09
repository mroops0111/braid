import type { EdgeId, NodeId } from '@braidhq/schema'
import { createContext, useContext } from 'react'

/**
 * Cross-tab navigation hook. Provided by `App.tsx`,
 * consumed by views such as proposal validation issues,
 * that want to deep-link into the Graph tab focused on a node.
 *
 * Edge focus is intentionally a no-op today,
 * since GraphSurface has no edge selection state.
 * The shape is kept so callers do not need a feature flag,
 * and when edge selection lands only this hook changes.
 */
export interface GraphNavigation {
  focusNode: (id: NodeId) => void
  focusEdge: (id: EdgeId) => void
  /**
   * Open the graph showing only these nodes and one hop around them.
   *
   * A set rather than a node, because what a reader wants to see is often a
   * slice: everything one document put into the model, say. Drawing that in a
   * side panel makes it too small to read, and the graph surface is already
   * the thing built to show it.
   */
  focusNodes: (ids: readonly NodeId[], origin: string) => void
}

export const GraphNavigationContext = createContext<GraphNavigation | null>(null)

export function useGraphNavigation(): GraphNavigation | null {
  return useContext(GraphNavigationContext)
}
