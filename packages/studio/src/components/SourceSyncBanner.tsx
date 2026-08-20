import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import { TopBanner } from './TopBanner'
import { Button } from './ui/button'

// A single miss is usually a blip the next pass clears,
// so hold the banner until a source keeps failing,
// and stops recovering on its own.
const FAILURES_BEFORE_WARNING = 3

interface SourceSyncBannerProps {
  workspaceId: string | null
  /** Opens the workspace details sheet, where per-source sync state lives. */
  onOpenDetails: () => void
}

/**
 * Top-of-app warning for a source whose refreshes keep failing.
 *
 * A mirror that stops updating is otherwise silent.
 * Runs keep working against the last good copy by design,
 * so without this the graph quietly describes week-old code,
 * and nobody has a reason to look.
 *
 * Polls rather than listening, since a refresh fails in the background,
 * with no event a client is subscribed to.
 */
export function SourceSyncBanner({ workspaceId, onOpenDetails }: SourceSyncBannerProps) {
  const { t } = useTranslation()
  const { data } = useQuery({
    queryKey: ['source-sync-states', workspaceId],
    queryFn: () => api.listSourceSyncStates(workspaceId!),
    enabled: !!workspaceId,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })

  const failing = (data?.states ?? []).filter(state => state.consecutiveFailures >= FAILURES_BEFORE_WARNING)
  if (!workspaceId || failing.length === 0)
    return null

  const only = failing[0]!
  const detail = failing.length === 1
    ? (
        <>
          <span className="font-mono">{only.sourceId}</span>
          {' '}
          {t('review.banners.sourceSyncFailingOne')}
        </>
      )
    : t('review.banners.sourceSyncFailingMany', { count: failing.length })

  return (
    <TopBanner
      tone="warning"
      icon={AlertTriangle}
      spin={false}
      label={t('review.banners.sourceSyncLabel')}
      detail={detail}
      actions={(
        <Button variant="ghost" size="sm" className="h-6 gap-1 text-2xs" onClick={onOpenDetails}>
          <ArrowRight className="size-3" />
          {t('review.banners.sourceAuthAction')}
        </Button>
      )}
    />
  )
}
