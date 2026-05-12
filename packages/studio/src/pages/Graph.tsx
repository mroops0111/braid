import type { GraphNode } from '@telos/schema'
import { GitBranch, X } from 'lucide-react'
import { useState } from 'react'
import { EmptyState } from '@/components/EmptyState'
import { StatusBadge } from '@/components/StatusBadge'
import { useModelSnapshot } from '@/lib/queries'

interface GraphPageProps {
  workspaceId: string
}

export function GraphPage({ workspaceId }: GraphPageProps) {
  const { data, isLoading } = useModelSnapshot(workspaceId)
  const [selected, setSelected] = useState<GraphNode | null>(null)

  if (isLoading)
    return <div className="p-4 text-sm text-muted-foreground">Loading graph…</div>
  if (!data)
    return <div className="p-4 text-sm text-muted-foreground">No data.</div>
  if (data.nodes.length === 0) {
    return (
      <EmptyState
        icon={GitBranch}
        title="Graph is empty"
        description="Run /telos-extract to populate it from your codebase and intent docs."
      />
    )
  }

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <NodeTable nodes={data.nodes} selectedId={selected?.id ?? null} onSelect={setSelected} />
        <EdgeTable edges={data.edges} />
      </div>
      {selected && (
        <aside className="w-96 shrink-0 overflow-y-auto scrollbar-thin border-l border-border bg-card">
          <NodeDetail node={selected} onClose={() => setSelected(null)} />
        </aside>
      )}
    </div>
  )
}

function NodeTable({
  nodes,
  selectedId,
  onSelect,
}: {
  nodes: readonly GraphNode[]
  selectedId: string | null
  onSelect: (node: GraphNode) => void
}) {
  return (
    <section>
      <h3 className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Nodes (
        {nodes.length}
        )
      </h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-y border-border text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-2 text-left font-semibold">ID</th>
            <th className="px-4 py-2 text-left font-semibold">Type</th>
            <th className="px-4 py-2 text-left font-semibold">Name</th>
            <th className="px-4 py-2 text-left font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {nodes.map(node => (
            <tr
              key={node.id}
              onClick={() => onSelect(node)}
              className={`cursor-pointer border-b border-border/50 transition-colors duration-150 hover:bg-accent ${
                node.id === selectedId ? 'bg-accent' : ''
              }`}
            >
              <td className="px-4 py-1.5 font-mono text-xs text-foreground">{node.id}</td>
              <td className="px-4 py-1.5 font-mono text-xs text-muted-foreground">{node.type}</td>
              <td className="px-4 py-1.5 text-foreground">{node.name}</td>
              <td className="px-4 py-1.5">
                <StatusBadge status={node.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function EdgeTable({ edges }: { edges: readonly { id: string, type: string, fromNodeId: string, toNodeId: string }[] }) {
  if (edges.length === 0)
    return null
  return (
    <section>
      <h3 className="px-4 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Edges (
        {edges.length}
        )
      </h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-y border-border text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-2 text-left font-semibold">Type</th>
            <th className="px-4 py-2 text-left font-semibold">From</th>
            <th className="px-4 py-2 text-left font-semibold">To</th>
          </tr>
        </thead>
        <tbody>
          {edges.map(edge => (
            <tr key={edge.id} className="border-b border-border/50">
              <td className="px-4 py-1.5 font-mono text-xs text-muted-foreground">{edge.type}</td>
              <td className="px-4 py-1.5 font-mono text-xs text-foreground">{edge.fromNodeId}</td>
              <td className="px-4 py-1.5 font-mono text-xs text-foreground">{edge.toNodeId}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function NodeDetail({ node, onClose }: { node: GraphNode, onClose: () => void }) {
  return (
    <div className="p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <div className="font-mono text-xs text-muted-foreground">{node.type}</div>
          <h2 className="text-sm font-semibold text-foreground">{node.name}</h2>
        </div>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Close"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <StatusBadge status={node.status} />
      {node.description && (
        <p className="mt-3 whitespace-pre-wrap text-sm text-foreground/90">{node.description}</p>
      )}
      <pre className="mt-4 overflow-x-auto rounded-md border border-border bg-background p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
        {JSON.stringify(node, null, 2)}
      </pre>
    </div>
  )
}
