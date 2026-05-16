import type { NodeProps } from '@xyflow/react'
import type { NodeCardNode } from './useGraphLayout'
import { Handle, Position } from '@xyflow/react'
import { cn } from '@/lib/utils'
import { NodeTypeBadge } from './NodeTypeBadge'
import { usePaletteContext } from './usePalette'

/**
 * Custom react-flow node. Visually matches the Linear list-row card:
 * 3px primary bar on the left when selected, type-coloured badge top
 * left, name as primary label, optional description preview as
 * subtitle. The raw `id` is not on the card because it's a
 * machine-facing identifier (`ctx.cart`, `agg.cart`) that adds noise
 * without helping the human reader; it shows up in the detail sheet.
 *
 * Handles are invisible because we never want users to draw new edges
 * from the canvas — graph mutations stay HITL-gated via Proposals.
 */
export function GraphNodeCard({ data, selected }: NodeProps<NodeCardNode>) {
  const { node } = data
  const palette = usePaletteContext()
  const subtitle = node.description?.trim() ?? ''
  return (
    <div
      className={cn(
        'relative w-[200px] rounded-md border bg-card px-3 py-2 transition-colors duration-150',
        selected ? 'border-primary' : 'border-border hover:border-border/80',
      )}
    >
      {selected && (
        <span className="absolute inset-y-1 left-0 w-[3px] rounded-r-full" style={palette.nodeDotStyle(node.type)} />
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
      {subtitle && (
        <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
          {subtitle}
        </div>
      )}
    </div>
  )
}
