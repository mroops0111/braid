import type { EdgeId, NodeId } from '@braidhq/schema'
import { createContext, useContext } from 'react'

/**
 * Cross-tab navigation hook. Provided by `App.tsx`, consumed by views
 * (e.g. proposal validation issues) that want to deep-link into the
 * Graph tab focused on a specific node.
 *
 * Edge focus is intentionally a no-op today (GraphSurface has no edge
 * selection state). The shape is kept so callers don't need a feature
 * flag — when edge selection lands, only this hook changes.
 */
export interface GraphNavigation {
  focusNode: (id: NodeId) => void
  focusEdge: (id: EdgeId) => void
}

export const GraphNavigationContext = createContext<GraphNavigation | null>(null)

export function useGraphNavigation(): GraphNavigation | null {
  return useContext(GraphNavigationContext)
}
