import type { NodeProps } from '@xyflow/react'
import type { NodeCardNode } from './useGraphLayout'
import { Handle, Position } from '@xyflow/react'
import { cn } from '@/lib/utils'
import { NodeTypeBadge, nodeTypeStyle } from './NodeTypeBadge'

/**
 * Custom react-flow node. Visually matches the Linear list-row card:
 * 3px primary bar on the left when selected, type-colored badge top
 * left, name + id in mono inside. Handles are invisible (`opacity-0`)
 * because we never want users to draw new edges from the canvas:
 * graph mutations are still HITL-gated via Proposals.
 */
export function GraphNodeCard({ data, selected }: NodeProps<NodeCardNode>) {
  const { node } = data
  const style = nodeTypeStyle(node.type)
  return (
    <div
      className={cn(
        'relative w-[200px] rounded-md border bg-card px-3 py-2 transition-colors duration-150',
        selected ? 'border-primary' : 'border-border hover:border-border/80',
      )}
    >
      {selected && (
        <span className={cn('absolute inset-y-1 left-0 w-[3px] rounded-r-full', style.bar)} />
      )}
      <Handle
        type="target"
        position={Position.Top}
        className="!h-2 !w-2 !border-border !bg-card opacity-0"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-2 !w-2 !border-border !bg-card opacity-0"
      />
      <div className="flex items-center gap-1.5">
        <NodeTypeBadge type={node.type} />
        <span className="text-[10px] text-muted-foreground">{node.status}</span>
      </div>
      <div className="mt-1 truncate text-sm font-medium text-foreground">{node.name}</div>
      <div className="truncate font-mono text-[10px] text-muted-foreground">{node.id}</div>
    </div>
  )
}
