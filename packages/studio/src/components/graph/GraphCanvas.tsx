import type { EdgeId, GraphEdge, GraphNode, NodeId } from '@braidhq/schema'
import type { NodeChange } from '@xyflow/react'
import type { GraphDataSource } from './GraphDataSource'
import type { NodeCardNode } from './useGraphLayout'
import { Background, BackgroundVariant, Controls, MarkerType, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react'
import { GitBranch, PanelLeftClose, PanelLeftOpen, Sparkles } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { optional } from '@/lib/optional'
import { useOntology } from '@/lib/queries'
import { useTheme } from '@/lib/theme'
import { useControllableState } from '@/lib/useControllableState'
import { EdgeDetailPanel } from './EdgeDetailPanel'
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
   * Controlled edge selection. Mirrors node selection; mutual
   * exclusion is the parent's responsibility (see GraphSurface's
   * setter pair). When omitted the canvas falls back to internal
   * state and still maintains its own mutual-exclusion invariant.
   */
  selectedEdgeId?: EdgeId | null
  onSelectEdge?: (id: EdgeId | null) => void
  /**
   * Controlled focus mode. When provided, the parent owns the on/off
   * state — pages set this from a page-level toolbar so the same
   * toggle drives both canvas and table.
   */
  focusMode?: boolean
  /**
   * When `true`, nodes and edges the proposal does not touch render at
   * a dimmed opacity, so the changed minority is what a reviewer's
   * eyes land on first. Set by `Proposals` when the user activates the
   * "Only changes" toggle. Has no effect outside proposal preview.
   */
  dimUnchanged?: boolean
  /**
   * When `true`, `added` nodes wear a green ring + accent dot instead
   * of just the small corner dot. Studio normally keeps `added` subtle
   * so a fresh-extract proposal (where 100% of nodes are added) is not
   * overwhelmed by green; for incremental proposals (small fraction of
   * the graph changed) the subtler treatment hides the diff. Caller
   * (Proposals) flips this on when the diff ratio is low.
   */
  emphasizeAdded?: boolean
  /**
   * When provided, the empty-graph EmptyState shows an action button
   * routing to the Batch surface. Lets a freshly-scaffolded workspace
   * discover the bootstrap flow.
   */
  onStartBootstrap?: () => void
}

const NODE_TYPES = { card: GraphNodeCard }

const INITIAL_FILTERS: GraphFilters = {
  search: '',
  types: [],
  orphansOnly: false,
}

export function GraphCanvas({ workspaceId, source, selectedNodeId, onSelectNode, selectedEdgeId, onSelectEdge, focusMode, dimUnchanged, emphasizeAdded, onStartBootstrap }: GraphCanvasProps) {
  const palette = usePalette(workspaceId)
  return (
    <PaletteProvider value={palette}>
      <ReactFlowProvider>
        <CanvasInner
          workspaceId={workspaceId}
          {...optional({ source, selectedNodeId, onSelectNode, selectedEdgeId, onSelectEdge, focusMode, dimUnchanged, emphasizeAdded, onStartBootstrap })}
        />
      </ReactFlowProvider>
    </PaletteProvider>
  )
}

function CanvasInner({ workspaceId, source, selectedNodeId: controlledSelected, onSelectNode, selectedEdgeId: controlledEdgeSelected, onSelectEdge, focusMode = false, dimUnchanged = false, emphasizeAdded = false, onStartBootstrap }: GraphCanvasProps) {
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
  const [selectedEdgeId, setSelectedEdgeId] = useControllableState<EdgeId | null>(controlledEdgeSelected, onSelectEdge, null)
  // Navigator stays open across both tab and preview modes so the filter chips are visible from the start.
  // Reviewers were getting stuck in preview mode wondering how to surface the relevant types.
  const [navigatorOpen, setNavigatorOpen] = useState(true)

  useFilterSeed(ontology, workspaceId, setFilters, diff !== undefined ? 'all' : 'defaultVisible')

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

  const dagreLaidOut = useGraphLayout(visible.nodes, visible.edges)
  // Session-only drag overrides. Each drag updates this map; on refresh
  // the graph re-lays out via dagre. Per-user persistence is deferred
  // until accounts ship: a server-side layout would be shared across
  // every collaborator on the workspace, which is worse than refresh
  // resetting. See ADR/discussion: 2026-06-04 polish branch.
  const [dragPositions, setDragPositions] = useState<Map<string, { x: number, y: number }>>(() => new Map())
  const laidOut = useMemo(() => {
    if (dragPositions.size === 0)
      return dagreLaidOut
    return {
      ...dagreLaidOut,
      nodes: dagreLaidOut.nodes.map((node) => {
        const dragPos = dragPositions.get(node.id)
        return dragPos ? { ...node, position: dragPos } : node
      }),
    }
  }, [dagreLaidOut, dragPositions])
  const reactFlow = useReactFlow()

  const { nodesById, incoming, outgoing } = useNodeNeighbors(allNodes, allEdges, selectedNodeId)

  const reactFlowNodes = useMemo(
    () => laidOut.nodes.map((n) => {
      const change = diff?.nodes.get(n.data.node.id)
      // Two independent dim conditions:
      //   - focus-style: a node is selected and this one isn't in its neighbourhood
      //   - only-changes: the proposal didn't touch this node
      // Either reason dims; both together still just dim once.
      const dimmedByFocus = selectedNodeId !== null && !focusMode && !neighborhood.neighbors.has(n.data.node.id)
      const dimmedByDiff = dimUnchanged && !change
      const dimmed = dimmedByFocus || dimmedByDiff
      return {
        ...n,
        selected: n.id === selectedNodeId,
        data: { ...n.data, change, emphasizeAdded },
        ...(dimmed ? { style: { opacity: DIMMED_NODE_OPACITY } } : {}),
      }
    }),
    [laidOut.nodes, selectedNodeId, diff, focusMode, neighborhood, dimUnchanged, emphasizeAdded],
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
      const dimmedByFocus = selectedNodeId !== null && !focusMode && !incident
      const dimmedByDiff = dimUnchanged && !change
      const dimmed = dimmedByFocus || dimmedByDiff
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
        label: selected ? palette.edgeLabel(edge.data!.edge.type) : undefined,
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
    [laidOut.edges, selectedEdgeId, palette, diff, selectedNodeId, focusMode, neighborhood, dimUnchanged],
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
  }, [setSelectedNodeId, setSelectedEdgeId])

  const selectEdge = useCallback((edgeId: EdgeId) => {
    setSelectedEdgeId(edgeId)
    setSelectedNodeId(null)
  }, [setSelectedEdgeId, setSelectedNodeId])

  const clearSelection = useCallback(() => {
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
  }, [setSelectedNodeId, setSelectedEdgeId])

  const selectAndCenter = useCallback((nodeId: NodeId) => {
    selectNode(nodeId)
    centerOnNode(nodeId)
  }, [centerOnNode, selectNode])

  // Direct canvas clicks use `selectNode` (no centering) — auto-pan
  // every click felt twitchy. Only navigator + detail-sheet entry
  // points go through `selectAndCenter`.

  // Edge-centring helper. Declared before any early return so the hook
  // call order is identical across renders (Rules of Hooks).
  const centerOnEdge = useCallback((edge: GraphEdge) => {
    const fromPos = laidOut.nodes.find(n => n.id === edge.fromNodeId)?.position
    const toPos = laidOut.nodes.find(n => n.id === edge.toNodeId)?.position
    if (!fromPos || !toPos)
      return
    const mx = (fromPos.x + toPos.x) / 2 + 100
    const my = (fromPos.y + toPos.y) / 2 + 32
    reactFlow.setCenter(mx, my, { zoom: 1, duration: 250 })
  }, [laidOut.nodes, reactFlow])

  useGraphShortcuts(reactFlow)

  // xyflow v12 controlled mode requires `onNodesChange` to advance the
  // visual during a drag. Mirroring position changes into
  // `dragPositions` makes the override layer in `laidOut` track the
  // cursor; the final position stays in the map after drag-end, so
  // subsequent re-renders keep the node where the user left it (until
  // refresh).
  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    setDragPositions((prev) => {
      let next = prev
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          if (next === prev)
            next = new Map(prev)
          next.set(change.id, { x: change.position.x, y: change.position.y })
        }
      }
      return next
    })
  }, [])

  if (isLoading)
    return <div className="p-4 text-sm text-muted-foreground">Loading graph…</div>
  if (allNodes.length === 0) {
    return (
      <EmptyState
        icon={GitBranch}
        title="Graph Is Empty"
        description="Bootstrap from every registered intent. If none exist, AI scans your codebases instead."
        action={onStartBootstrap
          ? (
              <Button size="sm" onClick={onStartBootstrap}>
                <Sparkles className="size-3.5" />
                Bootstrap From Sources
              </Button>
            )
          : undefined}
      />
    )
  }

  const selectedNode = selectedNodeId ? nodesById.get(selectedNodeId) ?? null : null
  const selectedEdge = selectedEdgeId
    ? allEdges.find(e => e.id === selectedEdgeId) ?? null
    : null
  const selectedEdgeFromNode = selectedEdge ? nodesById.get(selectedEdge.fromNodeId) : undefined
  const selectedEdgeToNode = selectedEdge ? nodesById.get(selectedEdge.toNodeId) : undefined
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
                onEdgeClick={(_event, e) => selectEdge(e.id as EdgeId)}
                onPaneClick={clearSelection}
                onNodesChange={handleNodesChange}
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
      {!selectedNode && selectedEdge && (
        <aside
          className="flex shrink-0 flex-col border-l border-border bg-card"
          style={{ width: NODE_DETAIL_ASIDE_WIDTH }}
        >
          <EdgeDetailPanel
            edge={selectedEdge}
            fromNode={selectedEdgeFromNode}
            toNode={selectedEdgeToNode}
            onClose={clearSelection}
            onSelectNode={selectAndCenter}
            onCenterInGraph={() => centerOnEdge(selectedEdge)}
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
