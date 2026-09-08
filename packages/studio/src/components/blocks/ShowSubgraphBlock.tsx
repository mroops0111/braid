import type { ShowSubgraph } from '@braidhq/schema'
import { NODE_REFERENCE_KIND } from '@braidhq/schema'
import { useTranslation } from 'react-i18next'
import { GraphCanvas } from '@/components/graph/GraphCanvas'
import { emphasizeAddedFor, useSubgraphDataSource } from '@/components/graph/GraphDataSource'
import { ReferenceTag } from '@/components/references/ReferenceTag'
import { usePendingOperations, useWorkspaceScope } from '@/lib/blocks/WorkspaceScopeContext'

/**
 * The slice of the graph an answer stands on, drawn by the graph surface itself.
 *
 * The same canvas, palette, and node cards the Graph view uses, fed a source
 * filtered to these ids. Drawing it any other way would give the product two
 * visual languages for one thing, and a reader would have to learn both.
 *
 * The block carries ids only, so names, types, and colours come from the live
 * snapshot and stay right when a node is renamed.
 */
export function ShowSubgraphBlock({ block }: { block: ShowSubgraph }) {
  const { t } = useTranslation()
  const workspaceId = useWorkspaceScope()
  const pending = usePendingOperations()
  const source = useSubgraphDataSource(workspaceId ?? '', block.nodes, pending)
  // A run names the nodes an answer stands on, and a run that proposes names
  // some it has only proposed. Previewing the pending changes puts those on
  // the canvas marked as additions, so the slice is whole. Anything still
  // missing is a citation the graph no longer accounts for, which is worth
  // saying out loud rather than quietly leaving a gap.
  const drawn = new Set(source.nodes.map(node => node.id))
  const missing = block.nodes.filter(nodeId => !drawn.has(nodeId))

  return (
    <figure className="my-1">
      <figcaption className="mb-2 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
        {block.title ?? t('blocks.subgraph.title')}
      </figcaption>
      {workspaceId && !source.isEmpty && (
        // Tall enough to read a dozen nodes without panning, short enough that
        // the answer around it stays the page.
        <div className="h-128 overflow-hidden rounded-md border border-border">
          <GraphCanvas
            workspaceId={workspaceId}
            source={source}
            embedded
            focusMode
            emphasizeAdded={emphasizeAddedFor(source)}
          />
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-1">
        {block.nodes.map(nodeId => (
          <ReferenceTag key={nodeId} reference={{ kind: NODE_REFERENCE_KIND, id: nodeId }} className="text-2xs" />
        ))}
      </div>
      {missing.length > 0 && (
        <p className="mt-1.5 text-2xs text-muted-foreground">
          {t('blocks.subgraph.notInGraph', { count: missing.length })}
        </p>
      )}
    </figure>
  )
}
