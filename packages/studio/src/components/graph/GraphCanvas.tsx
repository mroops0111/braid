import type { GraphEdge, GraphNode, NodeId } from '@braidhq/schema'
import type { GraphDataSource } from './GraphDataSource'
import type { NodeCardNode } from './useGraphLayout'
import { Background, BackgroundVariant, Controls, MarkerType, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react'
import { GitBranch, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { optional } from '@/lib/optional'
import { useOntology } from '@/lib/queries'
import { useTheme } from '@/lib/theme'
import { useControllableState } from '@/lib/useControllableState'
import { useLiveGraphDataSource } from './GraphDataSource'
import { type GraphFilters, GraphNavigator } from './GraphNavigator'
import { GraphNodeCard } from './GraphNodeCard'
import { computeNeighborhood } from './neighborhood'
import { NodeDetailPanel } from './NodeDetailPanel'
import { withAlpha } from './ontologyPalette'
import { DIMMED_EDGE_OPACITY, DIMMED_NODE_OPACITY, EDGE_DASH, EDGE_DIM_DEFAULT, EDGE_DIM_REMOVED, EDGE_STROKE, NODE_DETAIL_ASIDE_WIDTH } from './styleTokens'
import { useFilterSeed } from './useFilterSeed'
import { useFitOnLayoutChange } from './useFitOnLayoutChange'
import { useGraphLayout } from './useGraphLayout'
import { useGraphShortcuts } from './useGraphShortcuts'
import { useNodeNeighbors } from './useNodeNeighbors'
import { PaletteProvider, usePalette } from './usePalette'
import '@xyflow/react/dist/style.css'

interface GraphCanvasProps {
  workspaceId: string
  /**
   * Optional data source override. Defaults to the live workspace
   * snapshot. Proposal previews pass a derived source carrying a `diff`
   * overlay so the renderer can tint added / updated / removed elements
   * without knowing anything about proposals.
   */
  source?: GraphDataSource
  /**
   * Controlled selection. When both `selectedNodeId` and
   * `onSelectNode` are provided the canvas defers ownership to the
   * parent so a sibling view (e.g. table) can share the highlight. When
   * omitted the canvas falls back to internal state.
   */
  selectedNodeId?: NodeId | null
  onSelectNode?: (id: NodeId | null) => void
  /**
   * Controlled focus mode. When provided, the parent owns the on/off
   * state — pages set this from a page-level toolbar so the same
   * toggle drives both canvas and table.
   */
  focusMode?: boolean
}

const NODE_TYPES = { card: GraphNodeCard }

const INITIAL_FILTERS: GraphFilters = {
  search: '',
  types: [],
  orphansOnly: false,
}

export function GraphCanvas({ workspaceId, source, selectedNodeId, onSelectNode, focusMode }: GraphCanvasProps) {
  const palette = usePalette(workspaceId)
  return (
    <PaletteProvider value={palette}>
      <ReactFlowProvider>
        <CanvasInner
          workspaceId={workspaceId}
          {...optional({ source, selectedNodeId, onSelectNode, focusMode })}
        />
      </ReactFlowProvider>
    </PaletteProvider>
  )
}

function CanvasInner({ workspaceId, source, selectedNodeId: controlledSelected, onSelectNode, focusMode = false }: GraphCanvasProps) {
  // React Query dedupes the live snapshot fetch by queryKey, so it's
  // effectively free when `source` is supplied.
  const liveSource = useLiveGraphDataSource(workspaceId)
  const effective = source ?? liveSource
  const { data: ontology } = useOntology(workspaceId)
  const palette = usePalette(workspaceId)
  const { theme } = useTheme()
  const allNodes = effective.nodes
  const allEdges = effective.edges
  const isLoading = effective.isLoading
  const diff = effective.diff
  const [filters, setFilters] = useState<GraphFilters>(INITIAL_FILTERS)
  const [selectedNodeId, setSelectedNodeId] = useControllableState<NodeId | null>(controlledSelected, onSelectNode, null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  // Proposal-preview mode (diff present) collapses the navigator so
  // reviewers see the full diff without the filter/orphan/search panel
  // they don't need here.
  const [navigatorOpen, setNavigatorOpen] = useState(diff === undefined)

  useFilterSeed(ontology, workspaceId, setFilters)

  const orphanIds = useMemo(() => orphanNodeIds(allNodes, allEdges), [allNodes, allEdges])
  const filtered = useMemo(
    () => applyFilters(allNodes, allEdges, filters, orphanIds),
    [allNodes, allEdges, filters, orphanIds],
  )

  const neighborhood = useMemo(
    () => computeNeighborhood(selectedNodeId, filtered.edges),
    [selectedNodeId, filtered.edges],
  )
  // Focus mode shrinks the layout input so dagre doesn't lay out
  // off-screen cards that would just get filtered post-layout.
  const visible = useMemo(() => {
    if (!focusMode || !selectedNodeId)
      return filtered
    return {
      nodes: filtered.nodes.filter(n => neighborhood.neighbors.has(n.id)),
      edges: filtered.edges.filter(e => neighborhood.incidentEdges.has(e.id)),
    }
  }, [filtered, focusMode, selectedNodeId, neighborhood])

  const laidOut = useGraphLayout(visible.nodes, visible.edges)
  const reactFlow = useReactFlow()

  const { nodesById, incoming, outgoing } = useNodeNeighbors(allNodes, allEdges, selectedNodeId)

  const reactFlowNodes = useMemo(
    () => laidOut.nodes.map((n) => {
      const dimmed = selectedNodeId !== null && !focusMode && !neighborhood.neighbors.has(n.data.node.id)
      return {
        ...n,
        selected: n.id === selectedNodeId,
        data: { ...n.data, change: diff?.nodes.get(n.data.node.id) },
        ...(dimmed ? { style: { opacity: DIMMED_NODE_OPACITY } } : {}),
      }
    }),
    [laidOut.nodes, selectedNodeId, diff, focusMode, neighborhood],
  )

  // Edges keep their type colour so topology is readable; diff state
  // is signalled via stroke shape (dashed for removed, thicker for
  // added). Labels are hidden until selected — long-jump edges would
  // otherwise drop pills over every card they cross.
  const reactFlowEdges = useMemo(
    () => laidOut.edges.map((edge) => {
      const selected = edge.id === selectedEdgeId
      const change = diff?.edges.get(edge.data!.edge.id)
      const incident = neighborhood.incidentEdges.has(edge.data!.edge.id)
      const dimmed = selectedNodeId !== null && !focusMode && !incident
      const baseColor = palette.edgeColor(edge.data!.edge.type)
      const stroke = selected || incident
        ? baseColor
        : withAlpha(baseColor, change === 'removed' ? EDGE_DIM_REMOVED : EDGE_DIM_DEFAULT)
      const strokeWidth = selected
        ? EDGE_STROKE.selected
        : incident
          ? EDGE_STROKE.incident
          : change === 'added' ? EDGE_STROKE.added : EDGE_STROKE.default
      const strokeDasharray = change === 'removed'
        ? EDGE_DASH.removed
        : change === 'updated'
          ? EDGE_DASH.updated
          : undefined
      return {
        ...edge,
        selected,
        label: selected ? edge.label : undefined,
        animated: selected && change !== 'removed',
        style: {
          stroke,
          strokeWidth,
          ...(strokeDasharray ? { strokeDasharray } : {}),
          ...(dimmed ? { opacity: DIMMED_EDGE_OPACITY } : {}),
        },
        data: { ...edge.data!, change },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: stroke,
          width: 14,
          height: 14,
        },
        labelStyle: { fill: 'oklch(0.95 0 0)', fontSize: 11, fontFamily: 'JetBrains Mono Variable, monospace', fontWeight: 500 },
        labelBgStyle: { fill: 'oklch(0.165 0 0)', stroke: baseColor, strokeWidth: 1 },
        labelBgPadding: [8, 4] as [number, number],
        labelBgBorderRadius: 4,
        labelShowBg: true,
      }
    }),
    [laidOut.edges, selectedEdgeId, palette, diff, selectedNodeId, focusMode, neighborhood],
  )

  useFitOnLayoutChange(reactFlow, laidOut.nodes)

  const centerOnNode = useCallback((nodeId: NodeId) => {
    const positioned = laidOut.nodes.find(n => n.id === nodeId)
    if (!positioned)
      return
    reactFlow.setCenter(positioned.position.x + 100, positioned.position.y + 32, { zoom: 1, duration: 250 })
  }, [laidOut.nodes, reactFlow])

  // Node + edge selections are mutually exclusive — these helpers
  // encapsulate the "set one, clear the other" invariant so callers
  // can't accidentally leave both set.
  const selectNode = useCallback((nodeId: NodeId | null) => {
    setSelectedNodeId(nodeId)
    setSelectedEdgeId(null)
  }, [setSelectedNodeId])

  const selectEdge = useCallback((edgeId: string) => {
    setSelectedEdgeId(edgeId)
    setSelectedNodeId(null)
  }, [setSelectedNodeId])

  const clearSelection = useCallback(() => {
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
  }, [setSelectedNodeId])

  const selectAndCenter = useCallback((nodeId: NodeId) => {
    selectNode(nodeId)
    centerOnNode(nodeId)
  }, [centerOnNode, selectNode])

  // Direct canvas clicks use `selectNode` (no centering) — auto-pan
  // every click felt twitchy. Only navigator + detail-sheet entry
  // points go through `selectAndCenter`.

  useGraphShortcuts(reactFlow)

  if (isLoading)
    return <div className="p-4 text-sm text-muted-foreground">Loading graph…</div>
  if (allNodes.length === 0) {
    return (
      <EmptyState
        icon={GitBranch}
        title="Graph Is Empty"
        description="Run /braid-extract to populate it from your codebase and intent docs."
      />
    )
  }

  const selectedNode = selectedNodeId ? nodesById.get(selectedNodeId) ?? null : null
  // When we reach the `FilteredEmpty` branch below, `allNodes` is
  // non-empty (early return covers the zero case) and `filtered` is
  // empty — the filter is, by elimination, the cause. The previous
  // `filterActive` derived flag is now redundant.

  return (
    <div className="flex h-full">
      {navigatorOpen && (
        <GraphNavigator
          workspaceId={workspaceId}
          nodes={allNodes}
          orphanIds={orphanIds}
          filters={filters}
          onFiltersChange={setFilters}
        />
      )}

      <div className="relative flex-1 bg-background">
        <div className="absolute left-3 top-3 z-10">
          <button
            type="button"
            onClick={() => setNavigatorOpen(open => !open)}
            aria-label={navigatorOpen ? 'Collapse navigator' : 'Show navigator'}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground"
          >
            {navigatorOpen ? <PanelLeftClose className="size-3.5" /> : <PanelLeftOpen className="size-3.5" />}
          </button>
        </div>
        {filtered.nodes.length === 0
          ? (
              <FilteredEmpty
                onClear={() => setFilters({
                  ...INITIAL_FILTERS,
                  // Reset must enable every type currently present in
                  // the workspace; under the strict-whitelist convention
                  // an empty list would just stay empty.
                  types: Array.from(new Set(allNodes.map(n => n.type))),
                })}
              />
            )
          : (
              <ReactFlow
                nodes={reactFlowNodes}
                edges={reactFlowEdges}
                nodeTypes={NODE_TYPES}
                onNodeClick={(_event, n) => selectNode((n as NodeCardNode).data.node.id)}
                onEdgeClick={(_event, e) => selectEdge(e.id)}
                onPaneClick={clearSelection}
                fitView
                proOptions={{ hideAttribution: true }}
                minZoom={0.2}
                maxZoom={2}
                deleteKeyCode={null}
                nodesDraggable
                nodesConnectable={false}
              >
                <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="hsl(var(--border))" />
                <MiniMap
                  pannable
                  zoomable
                  // Mask alpha kept low (0.25) so type-coloured nodes
                  // remain legible — a higher alpha washes the minimap
                  // into a single block.
                  maskColor={theme === 'dark' ? 'oklch(0.17 0 0 / 0.25)' : 'oklch(0.97 0 0 / 0.25)'}
                  nodeColor={(n) => {
                    const data = n.data as { node?: { type?: string } } | undefined
                    const type = data?.node?.type
                    return type ? palette.nodeColor(type as never) : 'oklch(0.55 0 0)'
                  }}
                  nodeStrokeColor={theme === 'dark' ? 'oklch(0.85 0 0)' : 'oklch(0.3 0 0)'}
                  nodeStrokeWidth={1.5}
                  className="!bg-card !border !border-border"
                />
                <Controls
                  showInteractive={false}
                  className="!bg-card !border !border-border [&_button]:!bg-card [&_button]:!border-border [&_button]:!text-foreground"
                />
              </ReactFlow>
            )}
      </div>

      {selectedNode && (
        <aside
          className="flex shrink-0 flex-col border-l border-border bg-card"
          style={{ width: NODE_DETAIL_ASIDE_WIDTH }}
        >
          <NodeDetailPanel
            node={selectedNode}
            nodesById={nodesById}
            incoming={incoming}
            outgoing={outgoing}
            onClose={clearSelection}
            onSelectNode={selectAndCenter}
            onCenterInGraph={() => selectedNodeId && centerOnNode(selectedNodeId)}
          />
        </aside>
      )}
    </div>
  )
}

function FilteredEmpty({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-sm text-muted-foreground">No nodes match the current filter.</p>
      <Button variant="ghost" size="sm" onClick={onClear}>
        Reset Filters
      </Button>
    </div>
  )
}

interface FilteredGraph {
  nodes: readonly GraphNode[]
  edges: readonly GraphEdge[]
}

function applyFilters(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  filters: GraphFilters,
  orphanIds: ReadonlySet<NodeId>,
): FilteredGraph {
  const nodeMatches = nodes.filter((node) => {
    // Type filter is a strict whitelist: an empty list means *nothing*
    // matches (the user explicitly cleared all chips). The previous
    // "empty = show all" convention surprised users — clicking `clear`
    // looked like a no-op. Initial state is seeded from the ontology's
    // `defaultVisible` types so first render still has content.
    if (!filters.types.includes(node.type))
      return false
    if (filters.orphansOnly && !orphanIds.has(node.id))
      return false
    if (filters.search) {
      // Search is free-text against the human-facing content: name and
      // description. Structured criteria (type, orphan) have their own
      // filter UI; conflating them into search caused the "what does
      // typing here even do?" confusion.
      const needle = filters.search.toLowerCase()
      const haystack = `${node.name} ${node.description ?? ''}`.toLowerCase()
      if (!haystack.includes(needle))
        return false
    }
    return true
  })
  const includedIds = new Set<NodeId>(nodeMatches.map(n => n.id))
  const finalNodes = nodes.filter(n => includedIds.has(n.id))
  const finalEdges = edges.filter(e => includedIds.has(e.fromNodeId) && includedIds.has(e.toNodeId))
  return { nodes: finalNodes, edges: finalEdges }
}

function orphanNodeIds(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): Set<NodeId> {
  const referenced = new Set<NodeId>()
  for (const edge of edges) {
    referenced.add(edge.fromNodeId)
    referenced.add(edge.toNodeId)
  }
  const orphans = new Set<NodeId>()
  for (const node of nodes) {
    if (!referenced.has(node.id))
      orphans.add(node.id)
  }
  return orphans
}
