import type { ChangeKind, EdgeId, GraphEdge, GraphNode, NodeId, ProposalDiff } from '@braidhq/schema'
import { GitBranch } from 'lucide-react'
import { useMemo } from 'react'
import { EmptyState } from '@/components/EmptyState'
import { EdgeDetailPanel } from '@/components/graph/EdgeDetailPanel'
import { type GraphDataSource, useLiveGraphDataSource } from '@/components/graph/GraphDataSource'
import { computeNeighborhood } from '@/components/graph/neighborhood'
import { NodeDetailPanel } from '@/components/graph/NodeDetailPanel'
import { NodeTypeBadge } from '@/components/graph/NodeTypeBadge'
import { NODE_DETAIL_ASIDE_WIDTH } from '@/components/graph/styleTokens'
import { useNodeNeighbors } from '@/components/graph/useNodeNeighbors'
import { PaletteProvider, usePalette, usePaletteContext } from '@/components/graph/usePalette'
import { StatusBadge } from '@/components/StatusBadge'
import { optional } from '@/lib/optional'
import { useControllableState } from '@/lib/useControllableState'
import { cn } from '@/lib/utils'

interface GraphTablePageProps {
  workspaceId: string
  /**
   * Optional data source. Defaults to the live workspace snapshot.
   * Proposal previews pass a derived source carrying a `diff` map,
   * so the Change column lights up.
   */
  source?: GraphDataSource
  /**
   * Controlled selection.
   * When both `selectedNodeId` and `onSelectNode` are provided,
   * the table defers ownership to the parent,
   * so the sibling canvas shares the highlight.
   */
  selectedNodeId?: NodeId | null
  onSelectNode?: (id: NodeId | null) => void
  /**
   * Controlled edge selection. Mirrors `selectedNodeId`.
   * Mutual exclusion is the parent's responsibility.
   * When uncontrolled the table maintains the invariant internally.
   */
  selectedEdgeId?: EdgeId | null
  onSelectEdge?: (id: EdgeId | null) => void
  /**
   * Controlled focus mode. When provided, the parent owns on and off,
   * so the same toggle drives both canvas and table,
   * from a page-level toolbar.
   */
  focusMode?: boolean
  /**
   * Mirrors Canvas's `emphasizeAdded`. When `true`,
   * `added` rows carry a green ring on top of the Change badge,
   * so a small diff against a large graph still draws the eye.
   * Has no effect outside proposal preview.
   */
  emphasizeAdded?: boolean
}

export function GraphTablePage(props: GraphTablePageProps) {
  // Type colours come from the workspace's ontology via PaletteProvider,
  // so the table's badges read the same hues as the canvas's node cards.
  const palette = usePalette(props.workspaceId)
  return (
    <PaletteProvider value={palette}>
      <GraphTableInner {...props} />
    </PaletteProvider>
  )
}

function GraphTableInner({
  workspaceId,
  source,
  selectedNodeId: controlledSelected,
  onSelectNode,
  selectedEdgeId: controlledEdgeSelected,
  onSelectEdge,
  focusMode = false,
  emphasizeAdded = false,
}: GraphTablePageProps) {
  const liveSource = useLiveGraphDataSource(workspaceId)
  const effective = source ?? liveSource
  const [selectedId, setSelectedId] = useControllableState<NodeId | null>(controlledSelected, onSelectNode, null)
  const [selectedEdgeId, setSelectedEdgeId] = useControllableState<EdgeId | null>(controlledEdgeSelected, onSelectEdge, null)

  // Mutual-exclusion helpers match the Canvas's invariant,
  // so a user bouncing between the two views never lands,
  // on a state where both a node and an edge are highlighted at once.
  const selectNode = (id: NodeId | null): void => {
    setSelectedId(id)
    setSelectedEdgeId(null)
  }
  const selectEdge = (id: EdgeId | null): void => {
    setSelectedEdgeId(id)
    setSelectedId(null)
  }

  const neighborhood = useMemo(
    () => computeNeighborhood(selectedId, effective.edges),
    [selectedId, effective.edges],
  )

  if (effective.isLoading)
    return <div className="p-4 text-sm text-muted-foreground">Loading graph…</div>
  if (effective.nodes.length === 0) {
    return (
      <EmptyState
        icon={GitBranch}
        title="Graph Is Empty"
        description="Run /ddd:extract to populate it from your codebase and intent docs."
      />
    )
  }

  const { nodes, edges, diff } = effective
  const selectedNode = selectedId ? nodes.find(n => n.id === selectedId) ?? null : null
  const selectedEdge = selectedEdgeId ? edges.find(e => e.id === selectedEdgeId) ?? null : null
  const selectedEdgeFromNode = selectedEdge ? nodes.find(n => n.id === selectedEdge.fromNodeId) : undefined
  const selectedEdgeToNode = selectedEdge ? nodes.find(n => n.id === selectedEdge.toNodeId) : undefined
  // Visible set. In focus mode we hide non-neighbours entirely,
  // so the table shrinks.
  // Otherwise everything stays in the list, and non-neighbours are muted.
  const showAll = !focusMode || !selectedId
  const visibleNodes = showAll ? nodes : nodes.filter(n => neighborhood.neighbors.has(n.id))
  const visibleEdges = showAll ? edges : edges.filter(e => neighborhood.incidentEdges.has(e.id))
  const { nodesById, incoming, outgoing } = useNodeNeighbors(nodes, edges, selectedId)
  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto scrollbar-thin">
          <NodeTable
            nodes={visibleNodes}
            selectedId={selectedId}
            onSelect={node => selectNode(node.id)}
            neighbors={neighborhood.neighbors}
            dim={!showAll ? false : selectedId !== null}
            emphasizeAdded={emphasizeAdded}
            {...optional({ diff })}
          />
          <EdgeTable
            edges={visibleEdges}
            incidentEdges={neighborhood.incidentEdges}
            selectedId={selectedEdgeId}
            onSelect={edge => selectEdge(edge.id)}
            dim={!showAll ? false : selectedId !== null}
            emphasizeAdded={emphasizeAdded}
            {...optional({ diff })}
          />
        </div>
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
            onClose={() => selectNode(null)}
            onSelectNode={id => selectNode(id)}
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
            onClose={() => selectEdge(null)}
            onSelectNode={id => selectNode(id)}
          />
        </aside>
      )}
    </div>
  )
}

function NodeTable({
  nodes,
  diff,
  selectedId,
  onSelect,
  neighbors,
  dim,
  emphasizeAdded,
}: {
  nodes: readonly GraphNode[]
  diff?: ProposalDiff
  selectedId: string | null
  onSelect: (node: GraphNode) => void
  /** Used to mute rows outside the selection's neighbourhood when `dim` is on. */
  neighbors: ReadonlySet<NodeId>
  /** When true, rows not in `neighbors` render at reduced opacity. */
  dim: boolean
  /** When true, `added` rows pick up the same emerald ring that the Canvas applies on incremental proposals. */
  emphasizeAdded: boolean
}) {
  const showChange = diff !== undefined
  return (
    <section>
      <h3 className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Nodes (
        {nodes.length}
        )
      </h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-y border-border text-[11px] uppercase tracking-wider text-muted-foreground">
            {showChange && <th className="w-24 px-4 py-2 text-left font-semibold">Change</th>}
            <th className="w-32 px-4 py-2 text-left font-semibold">Type</th>
            <th className="px-4 py-2 text-left font-semibold">ID</th>
            <th className="px-4 py-2 text-left font-semibold">Name</th>
            <th className="px-4 py-2 text-left font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {nodes.map((node) => {
            const muted = dim && !neighbors.has(node.id as NodeId)
            const change = diff?.nodes.get(node.id as NodeId)
            const added = change === 'added' && emphasizeAdded
            return (
              <tr
                key={node.id}
                onClick={() => onSelect(node)}
                className={cn(
                  'cursor-pointer border-b border-border/50 transition-[opacity,background-color] duration-150 hover:bg-accent',
                  node.id === selectedId && 'bg-accent',
                  added && 'shadow-[inset_3px_0_0_0] shadow-emerald-500/70',
                  muted && 'opacity-30',
                )}
              >
                {showChange && (
                  <td className="px-4 py-1.5">
                    <ChangeBadge change={change} />
                  </td>
                )}
                <td className="px-4 py-1.5">
                  <NodeTypeBadge type={node.type} />
                </td>
                <td className="px-4 py-1.5 font-mono text-xs text-foreground">{node.id}</td>
                <td className="px-4 py-1.5 text-foreground">{node.name}</td>
                <td className="px-4 py-1.5">
                  <StatusBadge status={node.status} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}

function EdgeTable({
  edges,
  diff,
  incidentEdges,
  selectedId,
  onSelect,
  dim,
  emphasizeAdded,
}: {
  edges: readonly GraphEdge[]
  diff?: ProposalDiff
  incidentEdges: ReadonlySet<EdgeId>
  selectedId: EdgeId | null
  onSelect: (edge: GraphEdge) => void
  dim: boolean
  emphasizeAdded: boolean
}) {
  if (edges.length === 0)
    return null
  const showChange = diff !== undefined
  return (
    <section>
      <h3 className="px-4 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Edges (
        {edges.length}
        )
      </h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-y border-border text-[11px] uppercase tracking-wider text-muted-foreground">
            {showChange && <th className="w-24 px-4 py-2 text-left font-semibold">Change</th>}
            <th className="px-4 py-2 text-left font-semibold">Type</th>
            <th className="px-4 py-2 text-left font-semibold">From</th>
            <th className="px-4 py-2 text-left font-semibold">To</th>
          </tr>
        </thead>
        <tbody>
          {edges.map((edge) => {
            const muted = dim && !incidentEdges.has(edge.id as EdgeId)
            const change = diff?.edges.get(edge.id as EdgeId)
            const added = change === 'added' && emphasizeAdded
            return (
              <tr
                key={edge.id}
                onClick={() => onSelect(edge)}
                className={cn(
                  'cursor-pointer border-b border-border/50 transition-[opacity,background-color] duration-150 hover:bg-accent',
                  edge.id === selectedId && 'bg-accent',
                  added && 'shadow-[inset_3px_0_0_0] shadow-emerald-500/70',
                  muted && 'opacity-30',
                )}
              >
                {showChange && (
                  <td className="px-4 py-1.5">
                    <ChangeBadge change={change} />
                  </td>
                )}
                <td className="px-4 py-1.5">
                  <EdgeTypePill type={edge.type} />
                </td>
                <td className="px-4 py-1.5 font-mono text-xs text-foreground">{edge.fromNodeId}</td>
                <td className="px-4 py-1.5 font-mono text-xs text-foreground">{edge.toNodeId}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}

const CHANGE_BADGE_CLASS: Record<ChangeKind, string> = {
  added: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  updated: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  removed: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
}

function EdgeTypePill({ type }: { type: GraphEdge['type'] }) {
  // Edge palette uses CSS colour functions.
  // We apply alpha at consume sites,
  // to match the canvas's edge stroke treatment (dim and tinted).
  const palette = usePaletteContext()
  const color = palette.edgeColor(type)
  return (
    <span
      className="inline-flex items-center gap-1.5 font-mono text-xs"
      style={{ color }}
    >
      <span className="inline-block size-1.5 rounded-full" style={{ backgroundColor: color }} />
      {type}
    </span>
  )
}

function ChangeBadge({ change }: { change: ChangeKind | undefined }) {
  if (!change)
    return <span className="text-[11px] text-muted-foreground/50">·</span>
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wider ${CHANGE_BADGE_CLASS[change]}`}>
      {change}
    </span>
  )
}
