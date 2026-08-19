import type { EdgeId, GraphEdge, GraphNode, NodeId, NodeTypeId } from '@braidhq/schema'
import type { NodeChange } from '@xyflow/react'
import type { GraphDataSource } from './GraphDataSource'
import type { NodeCardNode } from './useGraphLayout'
import { localize } from '@braidhq/schema'
import { Background, BackgroundVariant, ControlButton, Controls, getNodesBounds, MarkerType, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react'
import { toPng, toSvg } from 'html-to-image'
import { Download, GitBranch, PanelLeftClose, PanelLeftOpen, RotateCcw, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { asEdgeId } from '@/lib/brands'
import { useLocale } from '@/lib/i18n'
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
import { matchesSearch, revealNode } from './revealFilters'
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
   * Optional data source override. Defaults to the live workspace snapshot.
   * Proposal previews pass a derived source carrying a `diff` overlay,
   * so the renderer can tint added, updated, and removed elements,
   * without knowing anything about proposals.
   */
  source?: GraphDataSource
  /**
   * Controlled selection.
   * When both `selectedNodeId` and `onSelectNode` are provided,
   * the canvas defers ownership to the parent,
   * so a sibling view such as the table can share the highlight.
   * When omitted the canvas falls back to internal state.
   */
  selectedNodeId?: NodeId | null
  onSelectNode?: (id: NodeId | null) => void
  /**
   * Controlled edge selection. Mirrors node selection.
   * Mutual exclusion is the parent's responsibility,
   * see GraphSurface's setter pair.
   * When omitted the canvas falls back to internal state,
   * and still maintains its own mutual-exclusion invariant.
   */
  /**
   * Bumped by a caller arriving from outside to pan onto the current selection.
   * Selection alone cannot trigger the pan,
   * since a direct canvas click changes the same value,
   * and auto-panning on those felt twitchy.
   */
  centerRequest?: number
  selectedEdgeId?: EdgeId | null
  onSelectEdge?: (id: EdgeId | null) => void
  /**
   * Controlled focus mode. When provided, the parent owns the on/off state.
   * Pages set this from a page-level toolbar,
   * so the same toggle drives both canvas and table.
   */
  focusMode?: boolean
  /**
   * When `true`, nodes and edges the proposal does not touch render dimmed,
   * so the changed minority is what a reviewer's eyes land on first.
   * Set by `Proposals` when the user activates the "Only changes" toggle.
   * Has no effect outside proposal preview.
   */
  dimUnchanged?: boolean
  /**
   * When `true`, `added` nodes wear a green ring and accent dot,
   * instead of just the small corner dot.
   * Studio normally keeps `added` subtle,
   * so a fresh-extract proposal where all nodes are added,
   * is not overwhelmed by green.
   * For an incremental proposal where a small fraction changed,
   * the subtler treatment hides the diff.
   * Caller `Proposals` flips this on when the diff ratio is low.
   */
  emphasizeAdded?: boolean
  /**
   * When provided, the empty-graph EmptyState shows an action button,
   * routing to the Batch surface.
   * Lets a freshly-scaffolded workspace discover the bootstrap flow.
   */
  onStartBootstrap?: () => void
}

const NODE_TYPES = { card: GraphNodeCard }

const INITIAL_FILTERS: GraphFilters = {
  search: '',
  types: [],
  orphansOnly: false,
}

// Show every edge's type label only when the visible set stays readable.
// A dense full graph would drop a pill over every card it crosses,
// so labels appear on a high-level or focused view, not the whole graph.
const EDGE_LABEL_LIMIT = 40

export function GraphCanvas({ workspaceId, source, selectedNodeId, onSelectNode, selectedEdgeId, onSelectEdge, focusMode, centerRequest, dimUnchanged, emphasizeAdded, onStartBootstrap }: GraphCanvasProps) {
  const palette = usePalette(workspaceId)
  return (
    <PaletteProvider value={palette}>
      <ReactFlowProvider>
        <CanvasInner
          workspaceId={workspaceId}
          {...optional({ source, selectedNodeId, onSelectNode, selectedEdgeId, onSelectEdge, focusMode, centerRequest, dimUnchanged, emphasizeAdded, onStartBootstrap })}
        />
      </ReactFlowProvider>
    </PaletteProvider>
  )
}

function CanvasInner({ workspaceId, source, selectedNodeId: controlledSelected, onSelectNode, selectedEdgeId: controlledEdgeSelected, onSelectEdge, focusMode = false, centerRequest = 0, dimUnchanged = false, emphasizeAdded = false, onStartBootstrap }: GraphCanvasProps) {
  const { t } = useTranslation()
  // React Query dedupes the live snapshot fetch by queryKey,
  // so it is effectively free when `source` is supplied.
  const liveSource = useLiveGraphDataSource(workspaceId)
  const effective = source ?? liveSource
  const { data: ontology } = useOntology(workspaceId)
  const { locale } = useLocale()
  // Name the bootstrap source by the ontology's unit-bearing role,
  // so the empty-state copy reads right for any ontology, not just DDD.
  const unitRole = localize(ontology?.sourceRoles.find(role => role.unitBearing)?.label ?? '', locale)
  const palette = usePalette(workspaceId)
  const { theme } = useTheme()
  const allNodes = effective.nodes
  const allEdges = effective.edges
  const isLoading = effective.isLoading
  const diff = effective.diff
  const [filters, setFilters] = useState<GraphFilters>(INITIAL_FILTERS)
  const [selectedNodeId, setSelectedNodeId] = useControllableState<NodeId | null>(controlledSelected, onSelectNode, null)
  const [selectedEdgeId, setSelectedEdgeId] = useControllableState<EdgeId | null>(controlledEdgeSelected, onSelectEdge, null)
  // Navigator stays open across tab and preview modes,
  // so the filter chips are visible from the start.
  // Reviewers got stuck in preview mode wondering how to surface types.
  const [navigatorOpen, setNavigatorOpen] = useState(true)
  const canvasRef = useRef<HTMLDivElement>(null)
  const [exporting, setExporting] = useState(false)

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
  // Focus mode shrinks the layout input,
  // so dagre does not lay out off-screen cards that get filtered later.
  const visible = useMemo(() => {
    if (!focusMode || !selectedNodeId)
      return filtered
    return {
      nodes: filtered.nodes.filter(n => neighborhood.neighbors.has(n.id)),
      edges: filtered.edges.filter(e => neighborhood.incidentEdges.has(e.id)),
    }
  }, [filtered, focusMode, selectedNodeId, neighborhood])

  const dagreLaidOut = useGraphLayout(visible.nodes, visible.edges)
  // Session-only drag overrides. Each drag updates this map.
  // On refresh the graph re-lays out via dagre.
  // Per-user persistence is deferred until accounts ship.
  // A server-side layout would be shared across every collaborator,
  // which is worse than a refresh resetting positions.
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
      // Two independent dim conditions.
      // - focus-style: a node is selected and this one is not its neighbour.
      // - only-changes: the proposal did not touch this node.
      // Either reason dims. Both together still just dim once.
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

  // Edges keep their type colour so topology is readable.
  // Diff state is signalled via stroke shape, dashed removed, thicker added.
  // Labels are hidden until selected,
  // long-jump edges would otherwise drop pills over every card they cross.
  const labelAllEdges = laidOut.edges.length <= EDGE_LABEL_LIMIT
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
        label: selected || (labelAllEdges && !dimmed) ? palette.edgeLabel(edge.data!.edge.type) : undefined,
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
        labelStyle: { fill: 'var(--foreground)', fontSize: 11, fontFamily: 'Geist Variable, sans-serif', fontWeight: 500 },
        labelBgStyle: { fill: 'var(--card)', stroke: baseColor, strokeWidth: 1 },
        labelBgPadding: [8, 4] as [number, number],
        labelBgBorderRadius: 4,
        labelShowBg: true,
      }
    }),
    [laidOut.edges, selectedEdgeId, palette, diff, selectedNodeId, focusMode, neighborhood, dimUnchanged, labelAllEdges],
  )

  useFitOnLayoutChange(reactFlow, laidOut.nodes)

  // Only-changes zooms the viewport onto the changed nodes,
  // so a small diff is enlarged rather than lost in the dimmed full graph.
  // Toggling it off restores the whole-graph frame.
  // Re-runs when the navigator collapses too, since that resizes the canvas.
  const changedNodeIds = useMemo(() => [...(diff?.nodes.keys() ?? [])], [diff])
  const didFitChangesRef = useRef(false)
  useEffect(() => {
    if (dimUnchanged && changedNodeIds.length > 0) {
      reactFlow.fitView({ nodes: changedNodeIds.map(id => ({ id })), padding: 0.4, maxZoom: 1.2, duration: 300 })
      didFitChangesRef.current = true
    }
    else if (didFitChangesRef.current) {
      reactFlow.fitView({ padding: 0.15, duration: 300 })
      didFitChangesRef.current = false
    }
  }, [dimUnchanged, changedNodeIds, reactFlow, navigatorOpen])

  const centerOnNode = useCallback((nodeId: NodeId) => {
    const positioned = laidOut.nodes.find(n => n.id === nodeId)
    if (!positioned)
      return
    reactFlow.setCenter(positioned.position.x + 100, positioned.position.y + 32, { zoom: 1, duration: 250 })
  }, [laidOut.nodes, reactFlow])

  // Serve an outside arrival by revealing the target, then panning onto it.
  // The two are separate passes,
  // since the relayout that follows a filter change lands on the next render,
  // and until then the target has no position to centre on.
  // The ref is seeded with the resting value, never the current one.
  // An arrival mounts this canvas,
  // so the request is already counted by first render.
  const servedCenterRef = useRef(0)
  useEffect(() => {
    if (centerRequest === servedCenterRef.current || !selectedNodeId)
      return
    const target = nodesById.get(selectedNodeId)
    if (!target)
      return
    const revealTarget = {
      node: target,
      isOrphan: orphanIds.has(target.id),
      neighbourTypes: neighbourTypesOf(selectedNodeId, incoming, outgoing, nodesById),
    }
    if (revealNode(filters, revealTarget) !== filters) {
      // An updater, not a plain value.
      // The ontology seed can already have a filter update queued this commit,
      // which a plain value would drop.
      setFilters(current => revealNode(current, revealTarget))
      return
    }
    if (!laidOut.nodes.some(n => n.id === selectedNodeId))
      return
    servedCenterRef.current = centerRequest
    centerOnNode(selectedNodeId)
  }, [centerRequest, selectedNodeId, nodesById, filters, orphanIds, incoming, outgoing, laidOut.nodes, centerOnNode])

  // Node and edge selections are mutually exclusive.
  // These helpers encapsulate the "set one, clear the other" invariant,
  // so callers cannot accidentally leave both set.
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

  // Direct canvas clicks use `selectNode` with no centering,
  // auto-pan on every click felt twitchy.
  // Only navigator and detail-sheet entry points use `selectAndCenter`.

  // Edge-centring helper. Declared before any early return,
  // so the hook call order is identical across renders (Rules of Hooks).
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

  // Export the visible graph as a clean image. We render `.react-flow__viewport`,
  // which holds only nodes and edges, so the minimap, controls, background,
  // and every panel are left out.
  // The transform reframes the node bounds into a margin,
  // so the file is sized to the graph, not the current pan and zoom.
  const exportImage = useCallback(async (format: 'png' | 'svg') => {
    const container = canvasRef.current
    const viewport = container?.querySelector<HTMLElement>('.react-flow__viewport')
    if (!container || !viewport)
      return
    setExporting(true)
    try {
      const bounds = getNodesBounds(reactFlow.getNodes())
      const margin = 48
      const width = Math.ceil(bounds.width) + margin * 2
      const height = Math.ceil(bounds.height) + margin * 2
      const backgroundColor = getComputedStyle(container).backgroundColor
      const style = {
        width: `${width}px`,
        height: `${height}px`,
        transform: `translate(${margin - bounds.x}px, ${margin - bounds.y}px) scale(1)`,
      }
      const dataUrl = format === 'png'
        ? await toPng(viewport, { backgroundColor, width, height, pixelRatio: 2, style })
        : await toSvg(viewport, { backgroundColor, width, height, style })
      const link = document.createElement('a')
      link.download = `${workspaceId}-${imageStamp()}.${format}`
      link.href = dataUrl
      link.click()
    }
    finally {
      setExporting(false)
    }
  }, [reactFlow, workspaceId])

  // xyflow v12 controlled mode requires `onNodesChange`,
  // to advance the visual during a drag.
  // Mirroring position changes into `dragPositions` tracks the cursor,
  // the final position stays in the map after drag-end.
  // Re-renders then keep the node where the user left it until refresh.
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
    return <div className="p-4 text-sm text-muted-foreground">{t('graph.loadingGraph')}</div>
  if (allNodes.length === 0) {
    return (
      <EmptyState
        icon={GitBranch}
        title={t('graph.empty.title')}
        description={t('graph.empty.canvasDescription', { unitRole })}
        action={onStartBootstrap
          ? (
              <Button size="sm" onClick={onStartBootstrap}>
                <Sparkles className="size-3.5" />
                {t('graph.empty.bootstrapButton')}
              </Button>
            )
          : undefined}
      />
    )
  }

  const selectedNode = selectedNodeId ? nodesById.get(selectedNodeId) ?? null : null
  const selectedNodeChange = selectedNode ? diff?.nodes.get(selectedNode.id) : undefined
  const selectedEdge = selectedEdgeId
    ? allEdges.find(e => e.id === selectedEdgeId) ?? null
    : null
  const selectedEdgeFromNode = selectedEdge ? nodesById.get(selectedEdge.fromNodeId) : undefined
  const selectedEdgeToNode = selectedEdge ? nodesById.get(selectedEdge.toNodeId) : undefined
  // When we reach the `FilteredEmpty` branch below, `allNodes` is non-empty,
  // and `filtered` is empty. The early return covers the zero case.
  // The filter is, by elimination, the cause.

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

      <div ref={canvasRef} className="relative flex-1 bg-background">
        <div className="absolute left-3 top-3 z-10">
          <button
            type="button"
            onClick={() => setNavigatorOpen(open => !open)}
            aria-label={navigatorOpen ? t('graph.navigator.collapseButton') : t('graph.navigator.showButton')}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground"
          >
            {navigatorOpen ? <PanelLeftClose className="size-3.5" /> : <PanelLeftOpen className="size-3.5" />}
          </button>
        </div>
        {filtered.nodes.length > 0 && (
          <div
            className="absolute right-3 top-3 z-10 flex items-center gap-0.5 rounded-md border border-border bg-card px-1 py-0.5 shadow-sm"
            title={t('graph.export.buttonTooltip')}
          >
            <Download className="size-3.5 text-muted-foreground" aria-hidden />
            <button
              type="button"
              onClick={() => exportImage('png')}
              disabled={exporting}
              aria-label={`${t('graph.export.buttonTooltip')} PNG`}
              className="rounded px-1.5 py-0.5 text-2xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              {t('graph.export.png')}
            </button>
            <button
              type="button"
              onClick={() => exportImage('svg')}
              disabled={exporting}
              aria-label={`${t('graph.export.buttonTooltip')} SVG`}
              className="rounded px-1.5 py-0.5 text-2xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              {t('graph.export.svg')}
            </button>
          </div>
        )}
        {filtered.nodes.length === 0
          ? (
              <FilteredEmpty
                onClear={() => setFilters({
                  ...INITIAL_FILTERS,
                  // Reset must enable every type currently in the workspace.
                  // Under the strict-whitelist convention,
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
                onEdgeClick={(_event, e) => selectEdge(asEdgeId(e.id))}
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
                  // Mask alpha kept low (0.25), so type-coloured nodes stay legible.
                  // A higher alpha washes the minimap into one block.
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
                >
                  {dragPositions.size > 0 && (
                    <ControlButton
                      onClick={() => setDragPositions(new Map())}
                      title={t('graph.resetLayoutTooltip')}
                    >
                      <RotateCcw className="size-3.5" />
                    </ControlButton>
                  )}
                </Controls>
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
            {...(selectedNodeChange ? { change: selectedNodeChange } : {})}
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
  const { t } = useTranslation()
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-sm text-muted-foreground">{t('graph.filteredEmpty.description')}</p>
      <Button variant="ghost" size="sm" onClick={onClear}>
        {t('graph.filteredEmpty.resetButton')}
      </Button>
    </div>
  )
}

/** Types sitting on the other end of the target's edges. */
function neighbourTypesOf(
  nodeId: NodeId,
  incoming: readonly GraphEdge[],
  outgoing: readonly GraphEdge[],
  nodesById: ReadonlyMap<NodeId, GraphNode>,
): NodeTypeId[] {
  const types: NodeTypeId[] = []
  for (const edge of [...incoming, ...outgoing]) {
    const otherId = edge.fromNodeId === nodeId ? edge.toNodeId : edge.fromNodeId
    const other = nodesById.get(otherId)
    if (other)
      types.push(other.type)
  }
  return types
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
    // Type filter is a strict whitelist.
    // An empty list means nothing matches, the user cleared all chips.
    // The "empty = show all" convention surprised users,
    // clicking `clear` looked like a no-op.
    // Initial state is seeded from the ontology's `defaultVisible` types,
    // so first render still has content.
    if (!filters.types.includes(node.type))
      return false
    if (filters.orphansOnly && !orphanIds.has(node.id))
      return false
    // Search is free-text against the human-facing content,
    // name and description.
    // Structured criteria such as type and orphan have their own filter UI.
    // Conflating them into search caused "what does typing here even do?".
    return matchesSearch(filters.search, node)
  })
  const includedIds = new Set<NodeId>(nodeMatches.map(n => n.id))
  const finalNodes = nodes.filter(n => includedIds.has(n.id))
  const finalEdges = edges.filter(e => includedIds.has(e.fromNodeId) && includedIds.has(e.toNodeId))
  return { nodes: finalNodes, edges: finalEdges }
}

// Local wall-clock stamp for a downloaded filename, YYYYMMDD-HHmmss.
// This is a presentation-only file label, so a direct clock read is fine.
function imageStamp(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
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
