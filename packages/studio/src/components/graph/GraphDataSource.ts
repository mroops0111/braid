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
 * The slice of the live graph a set of node ids names.
 *
 * Edges are kept only when both ends survive the filter, so the view never
 * draws a line to a node that is not on screen. Ids the snapshot does not
 * carry are dropped rather than invented, which is what a reader wants when
 * an answer cites a node that has since been removed.
 */
export function useSubgraphDataSource(
  workspaceId: string,
  nodeIds: readonly NodeId[],
): GraphDataSource {
  const { data, isLoading } = useModelSnapshot(workspaceId)
  const key = nodeIds.join(',')
  return useMemo<GraphDataSource>(() => {
    const wanted = new Set<string>(key.length > 0 ? key.split(',') : [])
    const nodes = (data?.nodes ?? []).filter(node => wanted.has(node.id))
    const present = new Set(nodes.map(node => node.id))
    const edges = (data?.edges ?? []).filter(edge => present.has(edge.fromNodeId) && present.has(edge.toNodeId))
    return {
      nodes,
      edges,
      isLoading,
      isEmpty: !isLoading && nodes.length === 0,
    }
  }, [data, isLoading, key])
}
