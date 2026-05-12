import type { GraphNode } from '@telos/schema'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { useModelSnapshot } from '@/lib/queries'

interface GraphPageProps {
  workspaceId: string
}

export function GraphPage({ workspaceId }: GraphPageProps) {
  const { data, isLoading } = useModelSnapshot(workspaceId)
  const [selected, setSelected] = useState<GraphNode | null>(null)

  if (isLoading)
    return <div className="p-4 text-sm text-zinc-500">Loading graph…</div>
  if (!data)
    return <div className="p-4 text-sm text-zinc-500">No data.</div>
  if (data.nodes.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
        Graph is empty. Run /telos-extract to populate it.
      </div>
    )
  }

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <NodeTable nodes={data.nodes} selectedId={selected?.id ?? null} onSelect={setSelected} />
        <EdgeTable edges={data.edges} />
      </div>
      {selected && (
        <aside className="w-96 shrink-0 overflow-y-auto scrollbar-thin border-l border-zinc-800 bg-zinc-925" style={{ backgroundColor: 'oklch(0.16 0 0)' }}>
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
      <h3 className="px-4 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
        Nodes (
        {nodes.length}
        )
      </h3>
      <table className="w-full text-sm">
        <thead className="text-zinc-500">
          <tr className="border-y border-zinc-800 text-[11px] uppercase tracking-wider">
            <th className="px-4 py-2 text-left font-medium">ID</th>
            <th className="px-4 py-2 text-left font-medium">Type</th>
            <th className="px-4 py-2 text-left font-medium">Name</th>
            <th className="px-4 py-2 text-left font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {nodes.map(node => (
            <tr
              key={node.id}
              onClick={() => onSelect(node)}
              className={`cursor-pointer border-b border-zinc-900 hover:bg-zinc-900 ${
                node.id === selectedId ? 'bg-zinc-900' : ''
              }`}
            >
              <td className="px-4 py-1.5 font-mono text-xs text-zinc-300">{node.id}</td>
              <td className="px-4 py-1.5 font-mono text-xs text-zinc-500">{node.type}</td>
              <td className="px-4 py-1.5 text-zinc-200">{node.name}</td>
              <td className="px-4 py-1.5">
                <Badge variant={node.status as never}>{node.status}</Badge>
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
      <h3 className="px-4 pb-1 pt-4 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
        Edges (
        {edges.length}
        )
      </h3>
      <table className="w-full text-sm">
        <thead className="text-zinc-500">
          <tr className="border-y border-zinc-800 text-[11px] uppercase tracking-wider">
            <th className="px-4 py-2 text-left font-medium">Type</th>
            <th className="px-4 py-2 text-left font-medium">From</th>
            <th className="px-4 py-2 text-left font-medium">To</th>
          </tr>
        </thead>
        <tbody>
          {edges.map(edge => (
            <tr key={edge.id} className="border-b border-zinc-900">
              <td className="px-4 py-1.5 font-mono text-xs text-zinc-500">{edge.type}</td>
              <td className="px-4 py-1.5 font-mono text-xs text-zinc-300">{edge.fromNodeId}</td>
              <td className="px-4 py-1.5 font-mono text-xs text-zinc-300">{edge.toNodeId}</td>
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
          <div className="font-mono text-xs text-zinc-500">{node.type}</div>
          <h2 className="text-sm font-semibold text-zinc-100">{node.name}</h2>
        </div>
        <button onClick={onClose} className="text-xs text-zinc-500 hover:text-zinc-200">close</button>
      </div>
      <Badge variant={node.status as never}>{node.status}</Badge>
      {node.description && (
        <p className="mt-3 whitespace-pre-wrap text-sm text-zinc-300">{node.description}</p>
      )}
      <pre className="mt-4 overflow-x-auto rounded border border-zinc-800 bg-zinc-950 p-2 font-mono text-[11px] text-zinc-400">
        {JSON.stringify(node, null, 2)}
      </pre>
    </div>
  )
}
