import type { RunStats } from '@/lib/blocks/runStats'
import { formatStats } from '@/lib/blocks/runStats'

/**
 * What the run cost, under the record of it.
 *
 * Kept out of the heading because it is not what anybody came to read. It
 * belongs to the log, so it sits at the end of the log, where somebody
 * checking a run's expense already is.
 */
export function RunCost({ stats }: { stats: RunStats | null }) {
  if (!stats)
    return null
  return (
    <p className="shrink-0 border-t border-border px-4 py-2 text-right font-mono text-2xs text-muted-foreground">
      {formatStats(stats)}
    </p>
  )
}
