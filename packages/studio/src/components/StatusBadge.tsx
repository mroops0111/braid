import { cn } from '@/lib/utils'

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground border-border',
  unclear: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  completed: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  deprecated: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
  pending: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  applied: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  rejected: 'bg-red-500/15 text-red-400 border-red-500/30',
}

export function StatusBadge({ status, className }: { status: string, className?: string }) {
  const style = STATUS_STYLES[status] ?? 'bg-muted text-muted-foreground border-border'
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide',
        style,
        className,
      )}
    >
      {status}
    </span>
  )
}
