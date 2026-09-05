import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/queries'
import { useEmbeddingProgress } from '@/lib/useEmbeddingProgress'
import { embeddingBannerState } from './embeddingBannerState'
import { TopBanner } from './TopBanner'
import { Button } from './ui/button'

interface EmbeddingRebuildBannerProps {
  workspaceId: string | null
}

/**
 * Says that ranking by meaning is incomplete right now, and offers the fix.
 *
 * Search leaves out any node whose vector no longer matches its text,
 * so during a rebuild it answers with less than the whole graph.
 * Without a word here that reads as search being broken.
 *
 * A graph that gained an embedding backend later reaches no other trigger,
 * since the reindexer waits on events that graph never emits.
 * This is the only way to build a first index.
 */
export function EmbeddingRebuildBanner({ workspaceId }: EmbeddingRebuildBannerProps) {
  // No workspace means no index to speak of, and the guard lives here so the
  // panel below can take a workspace rather than assert one.
  if (!workspaceId)
    return null
  return <WorkspaceEmbeddingBanner workspaceId={workspaceId} />
}

function WorkspaceEmbeddingBanner({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const state = embeddingBannerState(useEmbeddingProgress(workspaceId))

  const rebuild = useMutation({
    mutationFn: () => api.rebuildEmbeddings(workspaceId),
    onSuccess: () => {
      // The call answers with coverage as it stood,
      // so the banner would keep the old count until progress lands.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.embeddingCoverage(workspaceId),
      })
    },
  })

  const action = (label: string) => (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 gap-1 text-2xs [&_svg]:size-3"
      disabled={rebuild.isPending}
      onClick={() => rebuild.mutate()}
    >
      <RefreshCw />
      {label}
    </Button>
  )

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
          actions={action(t('review.banners.embeddingRetryButton'))}
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
          actions={action(t('review.banners.embeddingRebuildButton'))}
        />
      )
    default: {
      const exhaustive: never = state
      throw new Error(`Unhandled: ${JSON.stringify(exhaustive)}`)
    }
  }
}
