import type { EdgeId, NodeId } from '@braidhq/schema'
import type { GraphDataSource } from '@/components/graph/GraphDataSource'
import type { GraphView } from '@/components/graph/GraphToolbar'
import { useCallback, useState } from 'react'
import { GraphCanvas } from '@/components/graph/GraphCanvas'
import { FocusToggle, ViewToggle } from '@/components/graph/GraphToolbar'
import { useFocusedSelection } from '@/components/graph/useFocusedSelection'
import { optional } from '@/lib/optional'
import { GraphTablePage } from './GraphTable'

export type { GraphView } from '@/components/graph/GraphToolbar'

export interface GraphSurfaceProps {
  workspaceId: string
  /**
   * Optional preview source (proposal diff overlay).
   * Omit to render the live workspace snapshot via the internal fetch.
   */
  source?: GraphDataSource
  /**
   * The surface is fully controlled. The parent owns `view`,
   * `selectedNodeId`, `selectedEdgeId`, and `focusMode`,
   * so a page-level toolbar or section header can drive them.
   * Node and edge selection are mutually exclusive,
   * so setting one should clear the other in the parent's setter pair.
   */
  view: GraphView
  selectedNodeId: NodeId | null
  onSelectNode: (id: NodeId | null) => void
  selectedEdgeId: EdgeId | null
  onSelectEdge: (id: EdgeId | null) => void
  focusMode: boolean
  /**
   * Bumped by a caller that arrived from outside, such as a reference tag,
   * to pan the canvas onto the current selection.
   * A plain selection change cannot stand in for it,
   * since a direct canvas click changes the same value,
   * and auto-panning on those felt twitchy.
   */
  centerRequest?: number
  /** Opens the command palette from the navigator. */
  onOpenSearch?: () => void
  /** Proposal-preview only: see GraphCanvas for semantics. */
  dimUnchanged?: boolean
  /** Proposal-preview only: see GraphCanvas for semantics. */
  emphasizeAdded?: boolean
  onStartBootstrap?: () => void
}

/**
 * Renders either the Canvas or the Table,
 * for the same shared node, edge, focus, and diff-overlay state.
 * Consumed by the Graph page for a live snapshot,
 * and by the Proposals preview for a diff source.
 * Toolbar placement is left to the consumer.
 * See {@link GraphSurfaceActions} for the canonical Focus and ViewToggle pair,
 * when defaults suffice.
 */
export function GraphSurface({
  workspaceId,
  source,
  view,
  selectedNodeId,
  onSelectNode,
  selectedEdgeId,
  onSelectEdge,
  focusMode,
  centerRequest,
  onOpenSearch,
  dimUnchanged,
  emphasizeAdded,
  onStartBootstrap,
}: GraphSurfaceProps) {
  if (view === 'visualization') {
    return (
      <GraphCanvas
        workspaceId={workspaceId}
        {...optional({ source, centerRequest, dimUnchanged, emphasizeAdded, onStartBootstrap, onOpenSearch })}
        selectedNodeId={selectedNodeId}
        onSelectNode={onSelectNode}
        selectedEdgeId={selectedEdgeId}
        onSelectEdge={onSelectEdge}
        focusMode={focusMode}
      />
    )
  }
  return (
    <GraphTablePage
      workspaceId={workspaceId}
      {...optional({ source, emphasizeAdded })}
      selectedNodeId={selectedNodeId}
      onSelectNode={onSelectNode}
      selectedEdgeId={selectedEdgeId}
      onSelectEdge={onSelectEdge}
      focusMode={focusMode}
    />
  )
}

/** Hook bundling the shared state pages typically hoist for the surface. */
export function useGraphSurfaceState(initialView: GraphView = 'visualization') {
  const [view, setView] = useState<GraphView>(initialView)
  const selection = useFocusedSelection()
  // A counter, not a boolean, so two arrivals at the same node both pan.
  const [centerRequest, setCenterRequest] = useState(0)
  const requestCenter = useCallback(() => setCenterRequest(current => current + 1), [])
  return {
    view,
    setView,
    ...selection,
    centerRequest,
    requestCenter,
  }
}

/**
 * Canonical Focus and ViewToggle pair.
 * Focus stays here rather than in the canvas cluster,
 * since it is a mode and every control in that cluster fires once and returns.
 * It is disabled without a selection instead of hidden,
 * so the toolbar keeps its width.
 */
export function GraphSurfaceActions({
  view,
  onViewChange,
  selectedNodeId,
  focusMode,
  onFocusChange,
}: {
  view: GraphView
  onViewChange: (v: GraphView) => void
  selectedNodeId: NodeId | null
  focusMode: boolean
  onFocusChange: (next: boolean) => void
}) {
  return (
    <>
      <FocusToggle active={focusMode} disabled={!selectedNodeId} onChange={onFocusChange} />
      <ViewToggle view={view} onChange={onViewChange} />
    </>
  )
}
