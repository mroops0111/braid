import { cn } from '@/lib/utils'

const STATUS_STYLES: Record<string, { badge: string, dot: string }> = {
  draft: { badge: 'bg-muted text-muted-foreground border-border', dot: 'bg-muted-foreground/40' },
  unclear: { badge: 'bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300', dot: 'bg-amber-500' },
  completed: { badge: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300', dot: 'bg-emerald-500' },
  deprecated: { badge: 'bg-zinc-500/15 text-zinc-700 border-zinc-500/30 dark:text-zinc-300', dot: 'bg-zinc-500' },
  pending: { badge: 'bg-blue-500/15 text-blue-700 border-blue-500/30 dark:text-blue-300', dot: 'bg-blue-500' },
  applied: { badge: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300', dot: 'bg-emerald-500' },
  rejected: { badge: 'bg-red-500/15 text-red-700 border-red-500/30 dark:text-red-300', dot: 'bg-red-500' },
  // Finding verdicts, so a consistency card reads with one vocabulary,
  // the same as every other status rather than its own colour table.
  consistent: { badge: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300', dot: 'bg-emerald-500' },
  conflict: { badge: 'bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300', dot: 'bg-amber-500' },
  unverifiable: { badge: 'bg-zinc-500/15 text-zinc-700 border-zinc-500/30 dark:text-zinc-300', dot: 'bg-zinc-500' },
  // Drift severities, so a conflict is graded in the same vocabulary,
  // that the rest of Studio grades everything else in.
  error: { badge: 'bg-red-500/15 text-red-700 border-red-500/30 dark:text-red-300', dot: 'bg-red-500' },
  warning: { badge: 'bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300', dot: 'bg-amber-500' },
  info: { badge: 'bg-blue-500/15 text-blue-700 border-blue-500/30 dark:text-blue-300', dot: 'bg-blue-500' },
  // Where a source document stands against the model.
  // Registered here with everything else,
  // so the board tints from one table rather than a second that would drift.
  uncovered: { badge: 'bg-muted text-muted-foreground border-border', dot: 'bg-muted-foreground/40' },
  running: { badge: 'bg-blue-500/15 text-blue-700 border-blue-500/30 dark:text-blue-300', dot: 'bg-blue-500' },
  awaitingDecision: { badge: 'bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300', dot: 'bg-amber-500' },
  failed: { badge: 'bg-red-500/15 text-red-700 border-red-500/30 dark:text-red-300', dot: 'bg-red-500' },
  sourceChanged: { badge: 'bg-violet-500/15 text-violet-700 border-violet-500/30 dark:text-violet-300', dot: 'bg-violet-500' },
  conflicted: { badge: 'bg-orange-500/15 text-orange-700 border-orange-500/30 dark:text-orange-300', dot: 'bg-orange-500' },
  covered: { badge: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300', dot: 'bg-emerald-500' },
}

const NEUTRAL = { badge: 'bg-muted text-muted-foreground border-border', dot: 'bg-muted-foreground/40' }

/**
 * The tint a status carries,
 * for the places that need the colour without the badge around it.
 * Read from the one record,
 * so a dot and a badge for the same status can never come to disagree.
 */
export function statusTone(status: string): string {
  return (STATUS_STYLES[status] ?? NEUTRAL).badge
}

/** The solid mark, for a heading that names a status rather than carrying one. */
export function statusDot(status: string): string {
  return (STATUS_STYLES[status] ?? NEUTRAL).dot
}

export function StatusBadge({ status, label, className }: { status: string, label?: string, className?: string }) {
  const style = statusTone(status)
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wide',
        style,
        className,
      )}
    >
      {label ?? status}
    </span>
  )
}
