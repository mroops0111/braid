import type { GraphEdge, GraphNode, NodeId } from '@braidhq/schema'
import { NODE_REFERENCE_KIND } from '@braidhq/schema'
import { FileQuestion } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '@/components/EmptyState'
import { NodeDetailPanel } from '@/components/graph/NodeDetailPanel'
import { useNodeNeighbors } from '@/components/graph/useNodeNeighbors'
import { PaletteProvider, usePalette } from '@/components/graph/usePalette'
import { useModelSnapshot } from '@/lib/queries'
import { useReferencePeek } from './ReferencePeek'

// Stable identities, so the neighbour memos hold while the snapshot loads.
const NO_NODES: readonly GraphNode[] = []
const NO_EDGES: readonly GraphEdge[] = []

/**
 * The node kind's peek body, reusing the same panel the graph shows.
 * Selecting a neighbour swaps the peek target rather than navigating,
 * so a reader can walk a few hops without leaving their review.
 */
export function NodeReferenceDetail({ workspaceId, nodeId }: { workspaceId: string, nodeId: NodeId }) {
  const { t } = useTranslation()
  const peek = useReferencePeek()
  const { data: snapshot } = useModelSnapshot(workspaceId)
  const palette = usePalette(workspaceId)
  const { nodesById, incoming, outgoing } = useNodeNeighbors(
    snapshot?.nodes ?? NO_NODES,
    snapshot?.edges ?? NO_EDGES,
    nodeId,
  )
  const node = nodesById.get(nodeId)

  if (!node) {
    return (
      <EmptyState
        icon={FileQuestion}
        title={t('references.peek.missingTitle')}
        description={t('references.peek.missingDescription', { id: nodeId })}
      />
    )
  }

  return (
    <PaletteProvider value={palette}>
      <NodeDetailPanel
        node={node}
        nodesById={nodesById}
        incoming={incoming}
        outgoing={outgoing}
        onClose={() => peek?.close()}
        onSelectNode={neighbourId => peek?.open({ kind: NODE_REFERENCE_KIND, id: neighbourId })}
      />
    </PaletteProvider>
  )
}
