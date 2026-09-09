import { cn } from '@/lib/utils'

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground border-border',
  unclear: 'bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300',
  completed: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300',
  deprecated: 'bg-zinc-500/15 text-zinc-700 border-zinc-500/30 dark:text-zinc-300',
  pending: 'bg-blue-500/15 text-blue-700 border-blue-500/30 dark:text-blue-300',
  applied: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300',
  rejected: 'bg-red-500/15 text-red-700 border-red-500/30 dark:text-red-300',
  // Finding verdicts, so a consistency card reads with the same vocabulary
  // as every other status in Studio rather than its own colour table.
  consistent: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300',
  conflict: 'bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300',
  unverifiable: 'bg-zinc-500/15 text-zinc-700 border-zinc-500/30 dark:text-zinc-300',
  // Where a source document stands against the model. Registered here with
  // everything else so the board tints from the one table rather than a
  // second one that would drift away from it.
  uncovered: 'bg-muted text-muted-foreground border-border',
  running: 'bg-blue-500/15 text-blue-700 border-blue-500/30 dark:text-blue-300',
  awaitingDecision: 'bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300',
  failed: 'bg-red-500/15 text-red-700 border-red-500/30 dark:text-red-300',
  sourceChanged: 'bg-violet-500/15 text-violet-700 border-violet-500/30 dark:text-violet-300',
  conflicted: 'bg-orange-500/15 text-orange-700 border-orange-500/30 dark:text-orange-300',
  covered: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300',
}

/**
 * The tint a status carries, for the few places that need the colour without
 * the badge. Reading it from here is what keeps one vocabulary.
 */
export function statusTone(status: string): string {
  return STATUS_STYLES[status] ?? 'bg-muted text-muted-foreground border-border'
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
