import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import { TopBanner } from './TopBanner'
import { Button } from './ui/button'

// Short brand names for the source type tag. Proper nouns, not translated.
// The wizard's loaderKindLabel is unfit here,
// its "GitHub (issues)" already carries parentheses and would nest in the tag.
const SOURCE_TYPE_LABEL: Record<string, string> = { gdrive: 'Google Drive', github: 'GitHub' }

interface SourceAuthBannerProps {
  workspaceId: string | null
  /** Opens the workspace details sheet, where the per-source reconnect lives. */
  onOpenDetails: () => void
}

/**
 * Top-of-app warning for any OAuth source that cannot sync,
 * so a broken or unlinked connection surfaces without opening settings.
 * Covers both a stale token and a source that was never connected,
 * since either way the user must connect it.
 * Polls the summary, a token dies on a background refresh with no event.
 */
export function SourceAuthBanner({ workspaceId, onOpenDetails }: SourceAuthBannerProps) {
  const { t } = useTranslation()
  const { data } = useQuery({
    queryKey: ['source-connections', workspaceId],
    queryFn: () => api.listSourceConnections(workspaceId!),
    enabled: !!workspaceId,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })

  const unusable = (data?.connections ?? []).filter(connection => connection.needsAuth || !connection.connected)
  if (!workspaceId || unusable.length === 0)
    return null

  const only = unusable[0]!
  const detail = unusable.length === 1
    ? (
        <>
          <span className="font-mono">{only.name}</span>
          {' '}
          <span className="text-muted-foreground">{`(${SOURCE_TYPE_LABEL[only.kind] ?? only.kind})`}</span>
          {' '}
          {only.needsAuth ? t('review.banners.sourceAuthOne') : t('review.banners.sourceNotConnectedOne')}
        </>
      )
    : t('review.banners.sourceAttentionMany', { count: unusable.length })

  return (
    <TopBanner
      tone="warning"
      icon={AlertTriangle}
      spin={false}
      label={t('review.banners.sourceAuthLabel')}
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
