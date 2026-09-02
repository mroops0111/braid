import type { GraphEdge, GraphNode, NodeId } from '@braidhq/schema'
import { ArrowDownToDot, ArrowUpFromDot, FileText, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Markdown } from '@/components/SkillTranscript/Markdown'
import { StatusBadge } from '@/components/StatusBadge'
import { NodeTypeBadge } from './NodeTypeBadge'

type NodeChange = 'added' | 'updated' | 'removed'

interface NodeDetailPanelProps {
  node: GraphNode
  nodesById: ReadonlyMap<NodeId, GraphNode>
  incoming: readonly GraphEdge[]
  outgoing: readonly GraphEdge[]
  onClose: () => void
  onSelectNode: (nodeId: NodeId) => void
  /**
   * Diff state in a proposal preview.
   * Present only when the panel opens over a proposal's projected graph,
   * where it spells out `New` / `Updated` / `Removed` in full,
   * rather than the card's terse corner dot.
   */
  change?: NodeChange
  /**
   * Canvas-only affordance.
   * When present, a "Center in graph" footer button calls it.
   * The table view omits this prop since centering has no meaning there.
   */

}

/**
 * Shared right-side detail panel for both Canvas and Table views.
 *
 * Lives in-flow as a flex sibling, not a modal Sheet,
 * so its height matches the surrounding page chrome,
 * and stays consistent with the table's in-flow aside.
 */
export function NodeDetailPanel({
  node,
  nodesById,
  incoming,
  outgoing,
  onClose,
  onSelectNode,
  change,
}: NodeDetailPanelProps) {
  const { t } = useTranslation()
  const sources = node.metadata.sourceReferences ?? []
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="relative space-y-1.5 border-b border-border p-4">
        <button
          type="button"
          onClick={onClose}
          aria-label={t('graph.detail.closeDetailButton')}
          className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
        <div className="flex items-center gap-1.5">
          <NodeTypeBadge type={node.type} />
          <StatusBadge status={node.status} />
          {change && <ChangeBadge change={change} />}
        </div>
        <h2 className="text-sm font-semibold text-foreground">{node.name}</h2>
        <p className="font-mono text-2xs text-muted-foreground">{node.id}</p>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto p-4 scrollbar-thin">
        {node.description && (
          <section>
            <SectionTitle>{t('common.description')}</SectionTitle>
            <div className="mt-1 text-xs text-foreground/90">
              <Markdown text={node.description} />
            </div>
          </section>
        )}

        <FlagsSection node={node} />

        <EdgeList
          title={t('graph.detail.incoming', { count: incoming.length })}
          icon={ArrowDownToDot}
          edges={incoming}
          getOther={edge => edge.fromNodeId}
          nodesById={nodesById}
          onSelectNode={onSelectNode}
        />

        <EdgeList
          title={t('graph.detail.outgoing', { count: outgoing.length })}
          icon={ArrowUpFromDot}
          edges={outgoing}
          getOther={edge => edge.toNodeId}
          nodesById={nodesById}
          onSelectNode={onSelectNode}
        />

        <section>
          <SectionTitle>{t('graph.detail.sources')}</SectionTitle>
          {sources.length === 0
            ? <p className="mt-1 text-2xs text-muted-foreground">{t('graph.detail.noSources')}</p>
            : (
                <ul className="mt-1 space-y-1.5">
                  {sources.map((reference, index) => (
                    <li key={`${reference.sourceId}-${index}`} className="rounded-md border border-border p-2">
                      <div className="flex items-center gap-1.5 text-2xs">
                        <FileText className="size-3 text-muted-foreground" />
                        <span className="font-mono text-foreground">{reference.sourceId}</span>
                      </div>
                      <p className="mt-0.5 break-all font-mono text-2xs text-muted-foreground">
                        {formatLocation(reference.location.uri, reference.location.startLine, reference.location.endLine)}
                      </p>
                      {reference.snippet && (
                        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded-sm bg-muted/40 p-1.5 text-2xs text-foreground/80">
                          {reference.snippet}
                        </pre>
                      )}
                    </li>
                  ))}
                </ul>
              )}
        </section>
      </div>
    </div>
  )
}

function EdgeList({ title, icon: Icon, edges, getOther, nodesById, onSelectNode }: {
  title: string
  icon: typeof ArrowDownToDot
  edges: readonly GraphEdge[]
  getOther: (edge: GraphEdge) => NodeId
  nodesById: ReadonlyMap<NodeId, GraphNode>
  onSelectNode: (nodeId: NodeId) => void
}) {
  if (edges.length === 0)
    return null
  return (
    <section>
      <SectionTitle>{title}</SectionTitle>
      <ul className="mt-1 space-y-1">
        {edges.map((edge) => {
          const otherId = getOther(edge)
          const other = nodesById.get(otherId)
          return (
            <li key={edge.id}>
              <button
                type="button"
                onClick={() => onSelectNode(otherId)}
                className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-2xs hover:bg-accent"
              >
                <Icon className="size-3 shrink-0 text-muted-foreground" />
                <span className="text-2xs uppercase tracking-wider text-muted-foreground">{edge.type}</span>
                <span className="truncate text-foreground">{other?.name ?? otherId}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function FlagsSection({ node }: { node: GraphNode }) {
  const { t } = useTranslation()
  const flags: Array<{ label: string, tone: 'amber' | 'rose' }> = []
  for (const role of node.metadata.missingRoles ?? [])
    flags.push({ label: t('graph.detail.missingRole', { role }), tone: 'amber' })
  if (flags.length === 0)
    return null
  return (
    <section>
      <SectionTitle>{t('graph.detail.flags')}</SectionTitle>
      <ul className="mt-1 flex flex-wrap gap-1.5">
        {flags.map(flag => (
          <li
            key={flag.label}
            className={`inline-flex items-center rounded-sm border px-1.5 py-0.5 text-2xs uppercase tracking-wider ${
              flag.tone === 'amber'
                ? 'border-amber-500/30 bg-amber-500/15 text-amber-400'
                : 'border-rose-500/30 bg-rose-500/15 text-rose-400'
            }`}
          >
            {flag.label}
          </li>
        ))}
      </ul>
    </section>
  )
}

const CHANGE_BADGE = {
  added: { labelKey: 'graph.detail.changeNew', className: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-500' },
  updated: { labelKey: 'graph.detail.changeUpdated', className: 'border-amber-500/30 bg-amber-500/15 text-amber-500' },
  removed: { labelKey: 'graph.detail.changeRemoved', className: 'border-rose-500/30 bg-rose-500/15 text-rose-500' },
} as const

function ChangeBadge({ change }: { change: NodeChange }) {
  const { t } = useTranslation()
  const { labelKey, className } = CHANGE_BADGE[change]
  return (
    <span className={`inline-flex items-center rounded-sm border px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wider ${className}`}>
      {t(labelKey)}
    </span>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</h3>
  )
}

function formatLocation(uri: string, startLine?: number, endLine?: number): string {
  if (startLine === undefined)
    return uri
  if (endLine === undefined || endLine === startLine)
    return `${uri}:${startLine}`
  return `${uri}:${startLine}-${endLine}`
}
