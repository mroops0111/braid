import type { GraphEdge, GraphNode, NodeId } from '@telos/schema'
import type { NodeCardNode } from './useGraphLayout'
import { Background, BackgroundVariant, Controls, MarkerType, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react'
import { GitBranch } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { useModelSnapshot } from '@/lib/queries'
import { GraphDetailSheet } from './GraphDetailSheet'
import { type GraphFilters, GraphNavigator } from './GraphNavigator'
import { GraphNodeCard } from './GraphNodeCard'
import { useGraphLayout } from './useGraphLayout'
import '@xyflow/react/dist/style.css'

interface GraphCanvasProps {
  workspaceId: string
}

const NODE_TYPES = { card: GraphNodeCard }
const DEFAULT_EDGE_STYLE = { stroke: 'oklch(0.36 0 0)', strokeWidth: 1 }
const SELECTED_EDGE_STYLE = { stroke: 'oklch(0.62 0.18 274)', strokeWidth: 1.75 }
const DEFAULT_MARKER = { type: MarkerType.ArrowClosed, color: 'oklch(0.36 0 0)', width: 14, height: 14 }
const SELECTED_MARKER = { type: MarkerType.ArrowClosed, color: 'oklch(0.62 0.18 274)', width: 14, height: 14 }

const INITIAL_FILTERS: GraphFilters = {
  search: '',
  typeFilter: null,
  orphansOnly: false,
  draftOnly: false,
}

export function GraphCanvas({ workspaceId }: GraphCanvasProps) {
  // Wrap in a provider so `useReactFlow` in CanvasInner / the
  // "center in graph" detail-sheet action can read the same instance.
  return (
    <ReactFlowProvider>
      <CanvasInner workspaceId={workspaceId} />
    </ReactFlowProvider>
  )
}

function CanvasInner({ workspaceId }: GraphCanvasProps) {
  const { data, isLoading } = useModelSnapshot(workspaceId)
  const allNodes = data?.nodes ?? []
  const allEdges = data?.edges ?? []
  const [filters, setFilters] = useState<GraphFilters>(INITIAL_FILTERS)
  const [selectedNodeId, setSelectedNodeId] = useState<NodeId | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)

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

  const reactFlowEdges = useMemo(
    () => laidOut.edges.map((edge) => {
      const selected = edge.id === selectedEdgeId
      return {
        ...edge,
        selected,
        style: selected ? SELECTED_EDGE_STYLE : DEFAULT_EDGE_STYLE,
        markerEnd: selected ? SELECTED_MARKER : DEFAULT_MARKER,
        labelStyle: { fill: 'oklch(0.65 0 0)', fontSize: 10, fontFamily: 'JetBrains Mono Variable, monospace' },
        labelBgStyle: { fill: 'oklch(0.175 0 0)' },
        labelBgPadding: [4, 2] as [number, number],
        labelBgBorderRadius: 4,
      }
    }),
    [laidOut.edges, selectedEdgeId],
  )

  const centerOnNode = useCallback((nodeId: NodeId) => {
    const positioned = laidOut.nodes.find(n => n.id === nodeId)
    if (!positioned)
      return
    reactFlow.setCenter(positioned.position.x + 100, positioned.position.y + 32, { zoom: 1, duration: 250 })
  }, [laidOut.nodes, reactFlow])

  // When the user selects a node from the navigator, scroll the canvas to
  // it. We center on every selectedNodeId change to keep the picked node
  // visible regardless of how it was selected.
  useEffect(() => {
    if (selectedNodeId)
      centerOnNode(selectedNodeId)
  }, [selectedNodeId, centerOnNode])

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
  const filterActive = filters.search !== '' || filters.typeFilter !== null || filters.orphansOnly || filters.draftOnly

  return (
    <div className="flex h-full">
      <GraphNavigator
        nodes={allNodes}
        orphanIds={orphanIds}
        filters={filters}
        onFiltersChange={setFilters}
        selectedId={selectedNodeId}
        onSelect={(nodeId) => {
          setSelectedNodeId(nodeId)
          setSelectedEdgeId(null)
        }}
      />

      <div className="relative flex-1 bg-background">
        {filtered.nodes.length === 0
          ? (
              <FilteredEmpty onClear={() => setFilters(INITIAL_FILTERS)} active={filterActive} />
            )
          : (
              <ReactFlow
                nodes={reactFlowNodes}
                edges={reactFlowEdges}
                nodeTypes={NODE_TYPES}
                onNodeClick={(_event, n) => {
                  setSelectedNodeId((n as NodeCardNode).data.node.id)
                  setSelectedEdgeId(null)
                }}
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
        onSelectNode={(nodeId) => {
          setSelectedNodeId(nodeId)
          setSelectedEdgeId(null)
        }}
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
    if (filters.typeFilter && node.type !== filters.typeFilter)
      return false
    if (filters.orphansOnly && !orphanIds.has(node.id))
      return false
    if (filters.draftOnly && node.status !== 'draft')
      return false
    if (filters.search) {
      const needle = filters.search.toLowerCase()
      if (!node.name.toLowerCase().includes(needle) && !node.id.toLowerCase().includes(needle))
        return false
    }
    return true
  })
  // Pull in neighbours of the matched set when a typeFilter is active, so
  // the user can see how the filtered slice connects to the rest of the
  // graph. Pure search / status filters keep the strict subset.
  const includedIds = new Set<NodeId>(nodeMatches.map(n => n.id))
  if (filters.typeFilter) {
    for (const edge of edges) {
      if (includedIds.has(edge.fromNodeId))
        includedIds.add(edge.toNodeId)
      if (includedIds.has(edge.toNodeId))
        includedIds.add(edge.fromNodeId)
    }
  }
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
