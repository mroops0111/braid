import type { GraphEdge, GraphNode, NodeId } from '@braidhq/schema'
import { ArrowDownToDot, ArrowUpFromDot, FileText, X } from 'lucide-react'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { NodeTypeBadge } from './NodeTypeBadge'

interface GraphDetailSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  node: GraphNode | null
  nodesById: ReadonlyMap<NodeId, GraphNode>
  incoming: readonly GraphEdge[]
  outgoing: readonly GraphEdge[]
  onSelectNode: (nodeId: NodeId) => void
  onCenterInGraph: () => void
}

export function GraphDetailSheet({
  open,
  onOpenChange,
  node,
  nodesById,
  incoming,
  outgoing,
  onSelectNode,
  onCenterInGraph,
}: GraphDetailSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side="right"
        className="w-[440px] !max-w-none p-0"
        // Without this, every click outside the sheet bubbles to
        // onPointerDownOutside and dismisses it — including clicks on
        // the navigator that we explicitly want to keep the sheet
        // open for (switching the focused node).
        onInteractOutside={event => event.preventDefault()}
      >
        {node
          ? (
              <Body
                node={node}
                nodesById={nodesById}
                incoming={incoming}
                outgoing={outgoing}
                onSelectNode={onSelectNode}
                onCenterInGraph={onCenterInGraph}
              />
            )
          : <p className="p-6 text-sm text-muted-foreground">Click a node to inspect it.</p>}
      </SheetContent>
    </Sheet>
  )
}

function Body({ node, nodesById, incoming, outgoing, onSelectNode, onCenterInGraph }: {
  node: GraphNode
  nodesById: ReadonlyMap<NodeId, GraphNode>
  incoming: readonly GraphEdge[]
  outgoing: readonly GraphEdge[]
  onSelectNode: (nodeId: NodeId) => void
  onCenterInGraph: () => void
}) {
  const sources = node.metadata.sourceReferences ?? []
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="space-y-1.5 border-b border-border p-4">
        <div className="flex items-center gap-1.5">
          <NodeTypeBadge type={node.type} />
          <StatusBadge status={node.status} />
        </div>
        <h2 className="text-sm font-semibold text-foreground">{node.name}</h2>
        <p className="font-mono text-[10px] text-muted-foreground">{node.id}</p>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto p-4 scrollbar-thin">
        {node.description && (
          <section>
            <SectionTitle>Description</SectionTitle>
            <p className="mt-1 whitespace-pre-wrap text-xs text-foreground/90">{node.description}</p>
          </section>
        )}

        <FlagsSection node={node} />

        <EdgeList
          title={`Incoming (${incoming.length})`}
          icon={ArrowDownToDot}
          edges={incoming}
          getOther={edge => edge.fromNodeId}
          nodesById={nodesById}
          onSelectNode={onSelectNode}
        />

        <EdgeList
          title={`Outgoing (${outgoing.length})`}
          icon={ArrowUpFromDot}
          edges={outgoing}
          getOther={edge => edge.toNodeId}
          nodesById={nodesById}
          onSelectNode={onSelectNode}
        />

        <section>
          <SectionTitle>Sources</SectionTitle>
          {sources.length === 0
            ? <p className="mt-1 text-[11px] text-muted-foreground">No sourceReferences declared.</p>
            : (
                <ul className="mt-1 space-y-1.5">
                  {sources.map((reference, index) => (
                    <li key={`${reference.sourceId}-${index}`} className="rounded-md border border-border p-2">
                      <div className="flex items-center gap-1.5 text-[11px]">
                        <FileText className="size-3 text-muted-foreground" />
                        <span className="font-mono text-foreground">{reference.sourceId}</span>
                      </div>
                      <p className="mt-0.5 break-all font-mono text-[10px] text-muted-foreground">
                        {formatLocation(reference.location.uri, reference.location.startLine, reference.location.endLine)}
                      </p>
                      {reference.snippet && (
                        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded-sm bg-muted/40 p-1.5 text-[10px] text-foreground/80">
                          {reference.snippet}
                        </pre>
                      )}
                    </li>
                  ))}
                </ul>
              )}
        </section>
      </div>

      <div className="border-t border-border p-4">
        <Button variant="ghost" size="sm" className="w-full justify-center" onClick={onCenterInGraph}>
          Center in graph
        </Button>
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
                className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] hover:bg-accent"
              >
                <Icon className="size-3 shrink-0 text-muted-foreground" />
                <span className="font-mono text-[10px] text-muted-foreground">{edge.type}</span>
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
  const flags: Array<{ label: string, tone: 'amber' | 'rose' }> = []
  if (node.metadata.intentMissing)
    flags.push({ label: 'intent missing', tone: 'amber' })
  if (node.metadata.intentConflict)
    flags.push({ label: 'intent conflict', tone: 'rose' })
  if (node.metadata.implementationMissing)
    flags.push({ label: 'implementation missing', tone: 'amber' })
  if (flags.length === 0)
    return null
  return (
    <section>
      <SectionTitle>Flags</SectionTitle>
      <ul className="mt-1 flex flex-wrap gap-1.5">
        {flags.map(flag => (
          <li
            key={flag.label}
            className={`inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${
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

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</h3>
  )
}

function formatLocation(uri: string, startLine?: number, endLine?: number): string {
  if (startLine === undefined)
    return uri
  if (endLine === undefined || endLine === startLine)
    return `${uri}:${startLine}`
  return `${uri}:${startLine}-${endLine}`
}

// Re-exported for parity with the sidebar close pattern; not used internally
// since shadcn's Sheet wires its own close button.
export const CloseIcon = X
