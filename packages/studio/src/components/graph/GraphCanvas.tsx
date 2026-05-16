import type { GraphEdge, GraphNode, NodeId } from '@telos/schema'
import type { NodeCardNode } from './useGraphLayout'
import { Background, BackgroundVariant, Controls, MarkerType, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react'
import { GitBranch, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { useModelSnapshot, useOntology } from '@/lib/queries'
import { GraphDetailSheet } from './GraphDetailSheet'
import { type GraphFilters, GraphNavigator } from './GraphNavigator'
import { GraphNodeCard } from './GraphNodeCard'
import { useGraphLayout } from './useGraphLayout'
import { PaletteProvider, usePalette } from './usePalette'
import '@xyflow/react/dist/style.css'

interface GraphCanvasProps {
  workspaceId: string
  /** Visualization/Table toggle rendered top-right of the canvas. */
  viewToggle?: React.ReactNode
}

const NODE_TYPES = { card: GraphNodeCard }

const INITIAL_FILTERS: GraphFilters = {
  search: '',
  types: [],
  orphansOnly: false,
}

export function GraphCanvas({ workspaceId, viewToggle }: GraphCanvasProps) {
  // PaletteProvider exposes the workspace's resolved ontology colours
  // to every descendant (node cards, navigator rows, detail sheet).
  // ReactFlowProvider does the same for `useReactFlow`.
  const palette = usePalette(workspaceId)
  return (
    <PaletteProvider value={palette}>
      <ReactFlowProvider>
        <CanvasInner workspaceId={workspaceId} viewToggle={viewToggle} />
      </ReactFlowProvider>
    </PaletteProvider>
  )
}

function CanvasInner({ workspaceId, viewToggle }: GraphCanvasProps) {
  const { data, isLoading } = useModelSnapshot(workspaceId)
  const { data: ontology } = useOntology(workspaceId)
  const palette = usePalette(workspaceId)
  const allNodes = data?.nodes ?? []
  const allEdges = data?.edges ?? []
  const [filters, setFilters] = useState<GraphFilters>(INITIAL_FILTERS)
  const [selectedNodeId, setSelectedNodeId] = useState<NodeId | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [navigatorOpen, setNavigatorOpen] = useState(true)

  // Apply the ontology's `defaultVisible` types as the initial filter
  // once per workspace, when the ontology query first resolves. The
  // ref tracks which workspace we've already seeded so a refetch
  // doesn't clobber the user's later edits, and switching workspace
  // re-seeds for the new ontology.
  const seededWorkspaceRef = useRef<string | null>(null)
  useEffect(() => {
    if (!ontology || seededWorkspaceRef.current === workspaceId)
      return
    const defaults = ontology.nodeTypes.filter(d => d.defaultVisible).map(d => d.id)
    setFilters(f => ({ ...f, types: defaults }))
    seededWorkspaceRef.current = workspaceId
  }, [ontology, workspaceId])

  const orphanIds = useMemo(() => orphanNodeIds(allNodes, allEdges), [allNodes, allEdges])
  const filtered = useMemo(
    () => applyFilters(allNodes, allEdges, filters, orphanIds),
    [allNodes, allEdges, filters, orphanIds],
  )

  const laidOut = useGraphLayout(filtered.nodes, filtered.edges)
  const reactFlow = useReactFlow()

  const nodesById = useMemo(
    () => new Map<NodeId, GraphNode>(allNodes.map(n => [n.id, n])),
    [allNodes],
  )

  const incoming = useMemo(
    () => selectedNodeId ? allEdges.filter(e => e.toNodeId === selectedNodeId) : [],
    [allEdges, selectedNodeId],
  )
  const outgoing = useMemo(
    () => selectedNodeId ? allEdges.filter(e => e.fromNodeId === selectedNodeId) : [],
    [allEdges, selectedNodeId],
  )

  const reactFlowNodes = useMemo(
    () => laidOut.nodes.map(n => ({ ...n, selected: n.id === selectedNodeId })),
    [laidOut.nodes, selectedNodeId],
  )

  // Each edge is coloured by its type (contains=purple, accepts=emerald,
  // emits=amber, …) so the user can read the topology without clicking.
  // Labels stay hidden until the edge is selected — long-jump edges
  // crossing intermediate rows would otherwise put a pill over every
  // card they pass. The selected label uses a fully-opaque background
  // (NOT a tint) so it actually masks any line routed underneath it.
  const reactFlowEdges = useMemo(
    () => laidOut.edges.map((edge) => {
      const selected = edge.id === selectedEdgeId
      const baseColor = palette.edgeColor(edge.data!.edge.type)
      const stroke = selected ? baseColor : dim(baseColor, 0.5)
      const strokeWidth = selected ? 2 : 1.25
      return {
        ...edge,
        selected,
        label: selected ? edge.label : undefined,
        animated: selected,
        style: { stroke, strokeWidth },
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
    [laidOut.edges, selectedEdgeId, palette],
  )

  const centerOnNode = useCallback((nodeId: NodeId) => {
    const positioned = laidOut.nodes.find(n => n.id === nodeId)
    if (!positioned)
      return
    reactFlow.setCenter(positioned.position.x + 100, positioned.position.y + 32, { zoom: 1, duration: 250 })
  }, [laidOut.nodes, reactFlow])

  const selectAndCenter = useCallback((nodeId: NodeId) => {
    setSelectedNodeId(nodeId)
    setSelectedEdgeId(null)
    centerOnNode(nodeId)
  }, [centerOnNode])

  const selectOnly = useCallback((nodeId: NodeId) => {
    setSelectedNodeId(nodeId)
    setSelectedEdgeId(null)
  }, [])

  // Centering on every selection felt twitchy: clicking a node already in
  // view should just highlight it, not pan the canvas around. Only the
  // navigator and detail-sheet "click an edge endpoint" paths center
  // (they go through `selectAndCenter`); canvas / direct clicks call
  // `selectOnly` and leave the viewport alone.

  // Cmd+F focuses the navigator search; Cmd+0 fits the canvas to
  // viewport. Both are scoped to the Graph tab via mount/unmount.
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey))
        return
      if (event.key === 'f') {
        const input = document.querySelector<HTMLInputElement>('input[placeholder="Search nodes…"]')
        if (input) {
          event.preventDefault()
          input.focus()
          input.select()
        }
      }
      else if (event.key === '0') {
        event.preventDefault()
        reactFlow.fitView({ duration: 250 })
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [reactFlow])

  if (isLoading)
    return <div className="p-4 text-sm text-muted-foreground">Loading graph…</div>
  if (!data || allNodes.length === 0) {
    return (
      <EmptyState
        icon={GitBranch}
        title="Graph Is Empty"
        description="Run /telos-extract to populate it from your codebase and intent docs."
      />
    )
  }

  const selectedNode = selectedNodeId ? nodesById.get(selectedNodeId) ?? null : null
  const filterActive = filters.search !== '' || filters.orphansOnly || filters.types.length > 0

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
        {/* Top-left: navigator collapse toggle (desktop + mobile-ready). */}
        <div className="pointer-events-none absolute left-3 top-3 z-10">
          <button
            type="button"
            onClick={() => setNavigatorOpen(open => !open)}
            aria-label={navigatorOpen ? 'Collapse navigator' : 'Show navigator'}
            className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground"
          >
            {navigatorOpen ? <PanelLeftClose className="size-3.5" /> : <PanelLeftOpen className="size-3.5" />}
          </button>
        </div>
        {/* Top-right: Visualization / Table view toggle. */}
        {viewToggle && (
          <div className="pointer-events-none absolute right-3 top-3 z-10">
            <div className="pointer-events-auto">{viewToggle}</div>
          </div>
        )}
        {filtered.nodes.length === 0
          ? (
              <FilteredEmpty onClear={() => setFilters(INITIAL_FILTERS)} active={filterActive} />
            )
          : (
              <ReactFlow
                nodes={reactFlowNodes}
                edges={reactFlowEdges}
                nodeTypes={NODE_TYPES}
                onNodeClick={(_event, n) => selectOnly((n as NodeCardNode).data.node.id)}
                onEdgeClick={(_event, e) => {
                  setSelectedEdgeId(e.id)
                  setSelectedNodeId(null)
                }}
                onPaneClick={() => {
                  setSelectedNodeId(null)
                  setSelectedEdgeId(null)
                }}
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
                  maskColor="oklch(0.145 0 0 / 0.8)"
                  nodeColor="oklch(0.175 0 0)"
                  nodeStrokeColor="oklch(0.26 0 0)"
                  className="!bg-card !border !border-border"
                />
                <Controls
                  showInteractive={false}
                  className="!bg-card !border !border-border [&_button]:!bg-card [&_button]:!border-border [&_button]:!text-foreground"
                />
              </ReactFlow>
            )}
      </div>

      <GraphDetailSheet
        open={selectedNodeId !== null}
        onOpenChange={(open) => {
          if (!open)
            setSelectedNodeId(null)
        }}
        node={selectedNode}
        nodesById={nodesById}
        incoming={incoming}
        outgoing={outgoing}
        onSelectNode={selectAndCenter}
        onCenterInGraph={() => selectedNodeId && centerOnNode(selectedNodeId)}
      />
    </div>
  )
}

function FilteredEmpty({ onClear, active }: { onClear: () => void, active: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-sm text-muted-foreground">
        {active
          ? 'No nodes match the current filter.'
          : 'No nodes to show.'}
      </p>
      {active && (
        <Button variant="ghost" size="sm" onClick={onClear}>
          Clear filters
        </Button>
      )}
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
    if (filters.types.length > 0 && !filters.types.includes(node.type))
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

/**
 * Dim a CSS colour to a translucent version for unselected edge
 * strokes. Mirrors the `withAlpha` helper in ontologyPalette but
 * inlined here so GraphCanvas doesn't reach into palette internals.
 */
function dim(color: string, alpha: number): string {
  const trimmed = color.trim()
  if (/\/\s*[\d.]+\s*\)$/.test(trimmed))
    return trimmed
  if (trimmed.endsWith(')'))
    return `${trimmed.slice(0, -1)} / ${alpha})`
  return trimmed
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
