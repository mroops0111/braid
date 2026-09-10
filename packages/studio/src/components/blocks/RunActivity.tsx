import type { RunActivity as Activity } from '@/lib/blocks/runActivity'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

function Count({ value, label }: { value: number, label: string }) {
  if (value === 0)
    return null
  return (
    <span className="flex items-baseline gap-1">
      <span className="font-mono text-2xs font-medium text-foreground">{value}</span>
      <span className="text-2xs text-muted-foreground">{label}</span>
    </span>
  )
}

/**
 * The run, while it is still working.
 *
 * Blocks only start arriving near the end of a long run, so a surface that
 * shows nothing until then reads as broken. The stream already carries the
 * work, and the agent's own narration says more about where it is than any
 * spinner could.
 */
export function RunActivity({ activity }: { activity: Activity }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border bg-muted/20 px-3 py-2">
      <div className="flex items-center gap-2">
        <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
        <p className="min-w-0 flex-1 truncate text-2xs text-foreground/80">
          {activity.narration ?? t('blocks.activity.starting')}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-5">
        <Count value={activity.graphQueries} label={t('blocks.activity.graphQueries')} />
        <Count value={activity.toolCalls} label={t('blocks.activity.toolCalls')} />
        <Count value={activity.blocks} label={t('blocks.activity.rendered')} />
      </div>
    </div>
  )
}
