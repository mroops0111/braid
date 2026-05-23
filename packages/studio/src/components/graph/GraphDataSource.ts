import type {
  GraphEdge,
  GraphNode,
  GraphOperation,
  ModelSnapshot,
  ProposalDiff,
} from '@braidhq/schema'
import { previewProposal } from '@braidhq/schema'
import { useMemo } from 'react'
import { useModelSnapshot } from '@/lib/queries'

/**
 * Uniform view shape consumed by the graph visualization + table.
 *
 * Decoupling rendering from data acquisition lets us reuse the same
 * components for the live workspace graph, proposal previews, and
 * future read-only / historical views without conditionals leaking into
 * the renderer.
 *
 * `diff` is an optional overlay: when present, nodes and edges in the
 * map get tinted with a change-kind ring/badge.
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
 * Returns the projected nodes/edges plus a `diff` map for UI overlays.
 *
 * **`operations` must be referentially stable.** This hook memoises on
 * `data`, `isLoading`, and `operations` — if the caller rebuilds the
 * array each render, `previewProposal` re-runs every time. Real call
 * sites pass `proposal.operations` straight from a React-Query result,
 * which is stable across renders. Don't construct an inline array
 * literal at the call site.
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
