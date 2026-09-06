import type { ShowSubgraph } from '@braidhq/schema'
import { NODE_REFERENCE_KIND } from '@braidhq/schema'
import { useTranslation } from 'react-i18next'
import { GraphCanvas } from '@/components/graph/GraphCanvas'
import { useSubgraphDataSource } from '@/components/graph/GraphDataSource'
import { ReferenceTag } from '@/components/references/ReferenceTag'
import { useWorkspaceScope } from '@/lib/blocks/WorkspaceScopeContext'

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
  const source = useSubgraphDataSource(workspaceId ?? '', block.nodes)

  return (
    <figure className="my-1">
      <figcaption className="mb-2 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
        {block.title ?? t('blocks.subgraph.title')}
      </figcaption>
      {workspaceId && !source.isEmpty && (
        // Tall enough to read a dozen nodes without panning, short enough that
        // the answer around it stays the page.
        <div className="h-128 overflow-hidden rounded-md border border-border">
          <GraphCanvas workspaceId={workspaceId} source={source} embedded focusMode />
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-1">
        {block.nodes.map(nodeId => (
          <ReferenceTag key={nodeId} reference={{ kind: NODE_REFERENCE_KIND, id: nodeId }} className="text-2xs" />
        ))}
      </div>
    </figure>
  )
}
