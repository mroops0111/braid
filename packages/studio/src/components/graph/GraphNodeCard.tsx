import type { NodeProps } from '@xyflow/react'
import type { NodeCardNode } from './useGraphLayout'
import { Handle, Position } from '@xyflow/react'
import { Markdown } from '@/components/SkillTranscript/Markdown'
import { cn } from '@/lib/utils'
import { NodeTypeBadge } from './NodeTypeBadge'

/**
 * Custom react-flow node, styled to match the Linear list-row card.
 * A primary border when selected,
 * a type-coloured badge top-left, the name as primary label,
 * and an optional description preview as subtitle.
 * The raw `id` is not on the card because it is a machine-facing identifier,
 * such as `ctx.cart` or `agg.cart`, which adds noise,
 * without helping the human reader.
 * It shows up in the detail sheet instead.
 *
 * Handles are invisible because we never want users to draw new edges,
 * from the canvas.
 * Graph mutations stay HITL-gated via Proposals.
 */
export function GraphNodeCard({ data, selected }: NodeProps<NodeCardNode>) {
  const { node, change, emphasizeAdded } = data
  const firstParagraph = node.description?.split(/\n\s*\n/, 1)[0]?.trim() ?? ''
  // Diff signals layer without fighting the type and topology layer.
  //   - Always-on left bar carries node type colour.
  //   - Top-right corner dot signals diff state (green, amber, rose).
  //     One dot per change kind, including `added`,
  //     so every variant has a visible marker.
  //   - Border ring is added on top of the dot for `updated` and `removed`,
  //     because those need extra weight.
  //     Removed is destructive, updated changed semantics.
  //   - `added` keeps just the dot by default.
  //     In a fresh extraction every node would otherwise wear a green border,
  //     and the type colour would drown.
  //   - Incremental proposals flip `emphasizeAdded` on,
  //     so `added` also gets a green ring and shadow.
  //     The green minority in a sea of unchanged context,
  //     needs that extra weight to be noticed.
  //   - Selected border-primary trumps the diff border on click.
  // Removed cards also fade,
  // so they read as "will disappear" rather than "still here".
  const changeBorder = change === 'updated'
    ? 'border-amber-500/70 shadow-[0_0_0_1px] shadow-amber-500/30'
    : change === 'removed'
      ? 'border-rose-500/70 shadow-[0_0_0_1px] shadow-rose-500/30 opacity-60'
      : change === 'added' && emphasizeAdded
        ? 'border-emerald-500/70 shadow-[0_0_0_1px] shadow-emerald-500/30'
        : null
  const changeDotColor = change === 'added'
    ? 'bg-emerald-500'
    : change === 'updated'
      ? 'bg-amber-500'
      : change === 'removed'
        ? 'bg-rose-500'
        : null
  return (
    <div
      className={cn(
        'relative w-[200px] rounded-md border bg-card px-3 py-2 transition-colors duration-150',
        selected ? 'border-primary' : (changeBorder ?? 'border-border hover:border-border/80'),
      )}
    >
      {changeDotColor && (
        <span
          className={cn('absolute right-1.5 top-1.5 size-2 rounded-full', changeDotColor)}
          title={change === 'added' ? 'Added by this proposal' : change === 'updated' ? 'Updated by this proposal' : 'Removed by this proposal'}
        />
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
        <span className="text-2xs text-muted-foreground">{node.status}</span>
      </div>
      <div className="mt-1 truncate text-sm font-medium text-foreground">{node.name}</div>
      {firstParagraph && (
        <div className="mt-1 line-clamp-2 text-xs leading-snug text-muted-foreground [&_p]:!my-0 [&_p]:!text-xs [&_p]:!leading-snug">
          <Markdown text={firstParagraph} />
        </div>
      )}
    </div>
  )
}
