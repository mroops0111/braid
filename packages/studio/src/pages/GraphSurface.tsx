import type { EdgeId, NodeId } from '@braidhq/schema'
import type { GraphDataSource } from '@/components/graph/GraphDataSource'
import type { GraphView } from '@/components/graph/GraphToolbar'
import { useState } from 'react'
import { GraphCanvas } from '@/components/graph/GraphCanvas'
import { FocusToggle, ViewToggle } from '@/components/graph/GraphToolbar'
import { optional } from '@/lib/optional'
import { GraphTablePage } from './GraphTable'

export type { GraphView } from '@/components/graph/GraphToolbar'

export interface GraphSurfaceProps {
  workspaceId: string
  /**
   * Optional preview source (proposal diff overlay). Omit to render
   * the live workspace snapshot via the components' internal fetch.
   */
  source?: GraphDataSource
  /**
   * The surface is fully controlled — the parent owns `view`,
   * `selectedNodeId`, `selectedEdgeId`, and `focusMode` so a
   * page-level toolbar (or section header) can drive them.
   * Node and edge selection are mutually exclusive; setting one
   * should clear the other in the parent's setter pair.
   */
  view: GraphView
  selectedNodeId: NodeId | null
  onSelectNode: (id: NodeId | null) => void
  selectedEdgeId: EdgeId | null
  onSelectEdge: (id: EdgeId | null) => void
  focusMode: boolean
  /** Proposal-preview only: see GraphCanvas for semantics. */
  dimUnchanged?: boolean
  /** Proposal-preview only: see GraphCanvas for semantics. */
  emphasizeAdded?: boolean
}

/**
 * Renders either the Canvas or the Table for the same shared
 * (node selection, edge selection, focus, diff overlay) state.
 * Consumed by the Graph page (live snapshot) and the Proposals
 * preview (diff source). Toolbar placement is left to the consumer;
 * see {@link GraphSurfaceActions} for the canonical Focus +
 * ViewToggle pair when defaults suffice.
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
  dimUnchanged,
  emphasizeAdded,
}: GraphSurfaceProps) {
  if (view === 'visualization') {
    return (
      <GraphCanvas
        workspaceId={workspaceId}
        {...optional({ source, dimUnchanged, emphasizeAdded })}
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
  const [selectedNodeId, setSelectedNodeIdRaw] = useState<NodeId | null>(null)
  const [selectedEdgeId, setSelectedEdgeIdRaw] = useState<EdgeId | null>(null)
  const [focusMode, setFocusMode] = useState(false)
  // Node and edge selections are mutually exclusive; setting one
  // clears the other so callers can pass these setters straight
  // through without remembering the rule themselves.
  const setSelectedNodeId = (id: NodeId | null): void => {
    setSelectedNodeIdRaw(id)
    if (id !== null)
      setSelectedEdgeIdRaw(null)
  }
  const setSelectedEdgeId = (id: EdgeId | null): void => {
    setSelectedEdgeIdRaw(id)
    if (id !== null)
      setSelectedNodeIdRaw(null)
  }
  return {
    view,
    setView,
    selectedNodeId,
    setSelectedNodeId,
    selectedEdgeId,
    setSelectedEdgeId,
    focusMode,
    setFocusMode,
  }
}

/**
 * Canonical Focus + ViewToggle pair. Focus is hidden when no node is
 * selected (a no-op chord shouldn't sit in the toolbar). Pages with
 * extra views (e.g. Proposals' "list") can ignore this helper and
 * compose `FocusToggle` / `ViewToggle` directly.
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
      {selectedNodeId && <FocusToggle active={focusMode} onChange={onFocusChange} />}
      <ViewToggle view={view} onChange={onViewChange} />
    </>
  )
}
