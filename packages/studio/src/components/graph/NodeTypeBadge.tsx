import type { NodeTypeId } from '@telos/schema'
import { cn } from '@/lib/utils'

interface NodeTypeStyle {
  readonly bg: string
  readonly text: string
  readonly border: string
  readonly bar: string
}

/**
 * Type palette mirrors StatusBadge's `bg-{c}-500/15 / text-{c}-400 /
 * border-{c}-500/30` formula. boundedContext uses the primary purple so
 * the dominant container type matches the brand accent. Unknown types
 * fall back to muted so a future ontology can plug in without crashing
 * the renderer.
 */
const TYPE_STYLES: Record<string, NodeTypeStyle> = {
  boundedContext: { bg: 'bg-primary/15', text: 'text-primary', border: 'border-primary/30', bar: 'bg-primary' },
  aggregate: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/30', bar: 'bg-emerald-500' },
  command: { bg: 'bg-blue-500/15', text: 'text-blue-400', border: 'border-blue-500/30', bar: 'bg-blue-500' },
  query: { bg: 'bg-cyan-500/15', text: 'text-cyan-400', border: 'border-cyan-500/30', bar: 'bg-cyan-500' },
  event: { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/30', bar: 'bg-amber-500' },
  rule: { bg: 'bg-rose-500/15', text: 'text-rose-400', border: 'border-rose-500/30', bar: 'bg-rose-500' },
}

const FALLBACK: NodeTypeStyle = {
  bg: 'bg-muted',
  text: 'text-muted-foreground',
  border: 'border-border',
  bar: 'bg-muted-foreground',
}

export function nodeTypeStyle(type: NodeTypeId): NodeTypeStyle {
  return TYPE_STYLES[type] ?? FALLBACK
}

export function NodeTypeBadge({ type, className }: { type: NodeTypeId, className?: string }) {
  const style = nodeTypeStyle(type)
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm border px-1 py-0.5 text-[10px] font-medium uppercase tracking-wider',
        style.bg,
        style.text,
        style.border,
        className,
      )}
    >
      {type}
    </span>
  )
}
