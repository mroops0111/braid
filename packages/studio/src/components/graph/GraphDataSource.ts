import type {
  GraphEdge,
  GraphNode,
  GraphOperation,
  ModelSnapshot,
  NodeId,
  ProposalDiff,
} from '@braidhq/schema'
import { previewProposal } from '@braidhq/schema'
import { useMemo } from 'react'
import { useModelSnapshot } from '@/lib/queries'

/**
 * Uniform view shape consumed by the graph visualization and table.
 *
 * Decoupling rendering from data acquisition lets us reuse the same components,
 * for the live workspace graph, proposal previews,
 * and future read-only or historical views,
 * without conditionals leaking into the renderer.
 *
 * `diff` is an optional overlay.
 * When present, nodes and edges in the map get a change-kind ring or badge.
 */
export interface GraphDataSource {
  readonly nodes: readonly GraphNode[]
  readonly edges: readonly GraphEdge[]
  readonly isLoading: boolean
  readonly isEmpty: boolean
  readonly diff?: ProposalDiff
}

const EMPTY_SNAPSHOT: ModelSnapshot = { nodes: [], edges: [] }

export function useLiveGraphDataSource(workspaceId: string): GraphDataSource {
  const { data, isLoading } = useModelSnapshot(workspaceId)
  return useMemo<GraphDataSource>(() => {
    const nodes = data?.nodes ?? []
    const edges = data?.edges ?? []
    return {
      nodes,
      edges,
      isLoading,
      isEmpty: !isLoading && nodes.length === 0,
    }
  }, [data, isLoading])
}

/**
 * Derive a preview by applying `operations` to the live snapshot.
 * Returns the projected nodes and edges,
 * plus a `diff` map for UI overlays.
 *
 * `operations` must be referentially stable.
 * This hook memoises on `data`, `isLoading`, and `operations`.
 * If the caller rebuilds the array each render,
 * `previewProposal` re-runs every time.
 * Real call sites pass `proposal.operations` from a React-Query result,
 * which is stable across renders.
 * Do not construct an inline array literal at the call site.
 */
export function useProposalGraphDataSource(
  workspaceId: string,
  operations: readonly GraphOperation[],
): GraphDataSource {
  const { data, isLoading } = useModelSnapshot(workspaceId)
  return useMemo<GraphDataSource>(() => {
    const current: ModelSnapshot = data ?? EMPTY_SNAPSHOT
    const { snapshot, diff } = previewProposal(current, operations)
    return {
      nodes: snapshot.nodes,
      edges: snapshot.edges,
      isLoading,
      isEmpty: !isLoading && snapshot.nodes.length === 0,
      diff,
    }
  }, [data, isLoading, operations])
}

/**
 * The proposal's own neighbourhood, rather than the whole graph dimmed.
 *
 * Dimming leaves every untouched node in the layout,
 * so in a workspace of a thousand the handful that changed is a few marks,
 * somewhere in a wall of them.
 * Narrowing to what the proposal touches, plus one hop of context,
 * is what makes the change readable and a new edge's other end visible.
 */
export function narrowToChanges(source: GraphDataSource): GraphDataSource {
  if (!source.diff || (source.diff.nodes.size === 0 && source.diff.edges.size === 0))
    return source
  const changed = new Set(source.diff.nodes.keys())
  const context = new Set<string>(changed)
  for (const edge of source.edges) {
    // A changed edge is a change with no node of its own,
    // so both its ends are what there is to look at.
    // Narrowing on touched nodes alone leaves nothing to narrow to,
    // for a proposal that only draws edges between existing nodes,
    // and the control for it does nothing when pressed.
    const edgeChanged = source.diff.edges.has(edge.id)
    if (edgeChanged || changed.has(edge.fromNodeId))
      context.add(edge.toNodeId)
    if (edgeChanged || changed.has(edge.toNodeId))
      context.add(edge.fromNodeId)
  }
  const nodes = source.nodes.filter(node => context.has(node.id))
  const present = new Set(nodes.map(node => node.id))
  return {
    ...source,
    nodes,
    edges: source.edges.filter(edge => present.has(edge.fromNodeId) && present.has(edge.toNodeId)),
  }
}

/**
 * Threshold for `emphasizeAddedFor`.
 * A diff touching less than this fraction of what is drawn is incremental.
 */
const INCREMENTAL_RATIO_THRESHOLD = 0.3

/**
 * Whether `added` needs the heavier treatment on this particular source.
 *
 * An incremental diff dilutes its own visual,
 * a few green dots in a sea of unmarked context,
 * so under the threshold `added` earns a ring and shadow on its corner dot.
 * A fresh extraction touches nearly everything,
 * and there the subtle marker is right,
 * since a green border on every node would drown the type colour.
 *
 * Derived here rather than at each call site,
 * so the canvas, the table, and a subgraph cannot drift to different thresholds.
 */
export function emphasizeAddedFor(source: GraphDataSource): boolean {
  const changedCount = (source.diff?.nodes.size ?? 0) + (source.diff?.edges.size ?? 0)
  const totalCount = source.nodes.length + source.edges.length
  const incrementalRatio = totalCount > 0 ? changedCount / totalCount : 1
  return incrementalRatio < INCREMENTAL_RATIO_THRESHOLD
}

/**
 * The slice of the graph a set of node ids names.
 *
 * Edges are kept only when both ends survive the filter,
 * so the view never draws a line to a node that is not on screen.
 * Ids nothing accounts for are dropped rather than invented,
 * which is what a reader wants when an answer cites a removed node.
 *
 * `operations` are the changes still waiting on review.
 * A run that proposes names the nodes it is about to add,
 * alongside the ones it stood on,
 * and against the live snapshot alone half the slice was missing.
 * Previewing the operations first puts them on the canvas,
 * wearing the same `added` marking the proposal review uses,
 * so new and existing read apart without a visual vocabulary of their own.
 */
/** Shared, so a caller passing nothing does not defeat the memo below. */
const NO_OPERATIONS: readonly GraphOperation[] = Object.freeze([])

export function useSubgraphDataSource(
  workspaceId: string,
  nodeIds: readonly NodeId[],
  operations: readonly GraphOperation[] = NO_OPERATIONS,
): GraphDataSource {
  const { data, isLoading } = useModelSnapshot(workspaceId)
  const key = nodeIds.join(',')
  return useMemo<GraphDataSource>(() => {
    const current: ModelSnapshot = data ?? EMPTY_SNAPSHOT
    const { snapshot, diff } = operations.length > 0
      ? previewProposal(current, operations)
      : { snapshot: current, diff: undefined }
    const wanted = new Set<string>(key.length > 0 ? key.split(',') : [])
    const nodes = snapshot.nodes.filter(node => wanted.has(node.id))
    const present = new Set(nodes.map(node => node.id))
    const edges = snapshot.edges.filter(edge => present.has(edge.fromNodeId) && present.has(edge.toNodeId))
    return {
      nodes,
      edges,
      isLoading,
      isEmpty: !isLoading && nodes.length === 0,
      // Narrowed to what is drawn,
      // so `emphasizeAddedFor` measures this slice, not the whole proposal.
      ...(diff ? { diff: narrowDiff(diff, present, edges) } : {}),
    }
  }, [data, isLoading, key, operations])
}

function narrowDiff(diff: ProposalDiff, nodeIds: ReadonlySet<string>, edges: readonly GraphEdge[]): ProposalDiff {
  const drawnEdges = new Set(edges.map(edge => edge.id))
  return {
    nodes: new Map([...diff.nodes].filter(([id]) => nodeIds.has(id))),
    edges: new Map([...diff.edges].filter(([id]) => drawnEdges.has(id))),
  }
}
