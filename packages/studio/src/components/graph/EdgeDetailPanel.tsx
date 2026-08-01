import type { GraphEdge, GraphNode, NodeId } from '@braidhq/schema'
import { ArrowDownToDot, ArrowUpFromDot, FileText, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NodeTypeBadge } from './NodeTypeBadge'
import { usePaletteContext } from './usePalette'

interface EdgeDetailPanelProps {
  edge: GraphEdge
  fromNode: GraphNode | undefined
  toNode: GraphNode | undefined
  onClose: () => void
  /**
   * Click on the From or To node row jumps to that node's detail.
   * The parent is expected to swap edge selection for node selection,
   * to keep the mutual-exclusion invariant.
   */
  onSelectNode: (nodeId: NodeId) => void
  /**
   * Canvas-only affordance to focus the edge in the layout.
   * Omitted in the Table view since centering has no meaning there.
   */
  onCenterInGraph?: () => void
}

/**
 * Shared right-side detail panel for selected edges.
 * Mirrors the structure of `NodeDetailPanel`,
 * so users get the same vocabulary, Sources section and Centre-in-graph footer,
 * regardless of which kind of element they pick.
 * Edge-specific affordances are a typed pill that matches the palette,
 * plus From and To rows that jump the user to the relevant node.
 */
export function EdgeDetailPanel({
  edge,
  fromNode,
  toNode,
  onClose,
  onSelectNode,
  onCenterInGraph,
}: EdgeDetailPanelProps) {
  const sources = edge.metadata.sourceReferences ?? []
  const palette = usePaletteContext()
  const typeColor = palette.edgeColor(edge.type)
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="relative space-y-1.5 border-b border-border p-4">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close detail"
          className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
        <div className="flex items-center gap-1.5">
          <span
            className="inline-flex items-center gap-1.5 font-mono text-2xs"
            style={{ color: typeColor }}
          >
            <span className="inline-block size-1.5 rounded-full" style={{ backgroundColor: typeColor }} />
            {palette.edgeLabel(edge.type)}
          </span>
        </div>
        <h2 className="text-sm font-semibold text-foreground">Edge</h2>
        <p className="font-mono text-2xs text-muted-foreground">{edge.id}</p>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto p-4 scrollbar-thin">
        <section>
          <SectionTitle>Endpoints</SectionTitle>
          <ul className="mt-1 space-y-1">
            <EndpointRow
              icon={ArrowUpFromDot}
              label="From"
              nodeId={edge.fromNodeId}
              node={fromNode}
              onSelect={onSelectNode}
            />
            <EndpointRow
              icon={ArrowDownToDot}
              label="To"
              nodeId={edge.toNodeId}
              node={toNode}
              onSelect={onSelectNode}
            />
          </ul>
        </section>

        <section>
          <SectionTitle>Sources</SectionTitle>
          {sources.length === 0
            ? <p className="mt-1 text-2xs text-muted-foreground">No sourceReferences declared.</p>
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

      {onCenterInGraph && (
        <div className="border-t border-border p-4">
          <Button variant="ghost" size="sm" className="w-full justify-center" onClick={onCenterInGraph}>
            Center in Graph
          </Button>
        </div>
      )}
    </div>
  )
}

function EndpointRow({
  icon: Icon,
  label,
  nodeId,
  node,
  onSelect,
}: {
  icon: typeof ArrowUpFromDot
  label: string
  nodeId: NodeId
  node: GraphNode | undefined
  onSelect: (nodeId: NodeId) => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(nodeId)}
        className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-2xs hover:bg-accent"
      >
        <Icon className="size-3 shrink-0 text-muted-foreground" />
        <span className="w-10 shrink-0 text-2xs uppercase tracking-wider text-muted-foreground">{label}</span>
        {node
          ? (
              <>
                <NodeTypeBadge type={node.type} />
                <span className="truncate text-foreground">{node.name}</span>
              </>
            )
          : (
              <span className="truncate font-mono text-2xs text-muted-foreground">{nodeId}</span>
            )}
      </button>
    </li>
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
