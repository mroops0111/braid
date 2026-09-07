import { cn } from '@/lib/utils'

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground border-border',
  unclear: 'bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300',
  completed: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300',
  deprecated: 'bg-zinc-500/15 text-zinc-700 border-zinc-500/30 dark:text-zinc-300',
  pending: 'bg-blue-500/15 text-blue-700 border-blue-500/30 dark:text-blue-300',
  applied: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300',
  rejected: 'bg-red-500/15 text-red-700 border-red-500/30 dark:text-red-300',
  // A clarification waiting on a person, which reads as a question rather
  // than as a change, so it does not borrow the pending colour.
  asked: 'bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300',
  // Finding verdicts, so a consistency card reads with the same vocabulary
  // as every other status in Studio rather than its own colour table.
  consistent: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300',
  conflict: 'bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300',
  unverifiable: 'bg-zinc-500/15 text-zinc-700 border-zinc-500/30 dark:text-zinc-300',
}

export function StatusBadge({ status, className }: { status: string, className?: string }) {
  const style = STATUS_STYLES[status] ?? 'bg-muted text-muted-foreground border-border'
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wide',
        style,
        className,
      )}
    >
      {status}
    </span>
  )
}
