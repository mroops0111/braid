import type { NodeTypeId } from '@braidhq/schema'
import { cn } from '@/lib/utils'
import { usePaletteContext } from './usePalette'

/**
 * Type badge whose colour is sourced from the workspace's resolved
 * ontology via PaletteContext. The colour string comes from the
 * `Ontology.nodeTypes[].color` descriptor field; ontologies that skip
 * `color` get a deterministic hash-of-id fallback so the badge still
 * renders distinguishable types.
 */
export function NodeTypeBadge({ type, className }: { type: NodeTypeId, className?: string }) {
  const palette = usePaletteContext()
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm border px-1 py-0.5 text-[10px] font-medium uppercase tracking-wider',
        className,
      )}
      style={palette.nodeBadgeStyle(type)}
    >
      {type}
    </span>
  )
}
