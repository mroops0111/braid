import { AlertCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useEmbeddingProgress } from '@/lib/useEmbeddingProgress'
import { embeddingBannerState } from './embeddingBannerState'
import { TopBanner } from './TopBanner'

interface EmbeddingRebuildBannerProps {
  workspaceId: string | null
}

/**
 * Says that ranking by meaning is incomplete right now.
 *
 * Search leaves out any node whose vector no longer matches its text,
 * so during a rebuild it answers with less than the whole graph.
 * Without a word here that reads as search being broken.
 */
export function EmbeddingRebuildBanner({ workspaceId }: EmbeddingRebuildBannerProps) {
  const { t } = useTranslation()
  const state = embeddingBannerState(useEmbeddingProgress(workspaceId))

  switch (state.kind) {
    case 'hidden':
      return null
    case 'failed':
      return (
        <TopBanner
          tone="warning"
          label={t('review.banners.embeddingFailedLabel')}
          detail={t('review.banners.embeddingFailedDetail', { message: state.message })}
          icon={AlertCircle}
          spin={false}
        />
      )
    case 'rebuilding':
      return (
        <TopBanner
          tone="batch"
          label={t('review.banners.embeddingRebuildingLabel')}
          detail={t('review.banners.embeddingRebuildingDetail', { done: state.done, total: state.total })}
        />
      )
    case 'stale':
      return (
        <TopBanner
          tone="warning"
          label={t('review.banners.embeddingStaleLabel')}
          detail={t('review.banners.embeddingStaleDetail', { stale: state.stale, total: state.total })}
          icon={AlertCircle}
          spin={false}
        />
      )
    default: {
      const exhaustive: never = state
      throw new Error(`Unhandled: ${JSON.stringify(exhaustive)}`)
    }
  }
}
