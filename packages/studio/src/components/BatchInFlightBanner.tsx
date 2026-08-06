import { AlertCircle, CheckCircle2, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useBatchStatus } from '@/lib/queries'
import { TopBanner } from './TopBanner'
import { Button } from './ui/button'

interface BatchInFlightBannerProps {
  workspaceId: string | null
  onOpenBatch: () => void
  suppress?: boolean
}

type Mode =
  | { kind: 'active', label: string, completed: number, total: number }
  | { kind: 'resumable', completed: number, total: number }
  | { kind: 'completed', completed: number, total: number }

// Cross-surface entry to the Batch view.
// Hidden on the Batch surface itself, and when no plan exists.
export function BatchInFlightBanner({ workspaceId, onOpenBatch, suppress }: BatchInFlightBannerProps) {
  const { t } = useTranslation()
  const { data: plan } = useBatchStatus(workspaceId ?? undefined)
  // `archived` is the user's explicit "I'm done seeing this" signal,
  // so the banner stays hidden until a new plan kicks off.
  if (!plan || suppress || plan.status === 'idle' || plan.status === 'archived')
    return null

  const completed = plan.units.filter(u => u.status === 'completed').length
  const total = plan.units.length
  const unfinished = plan.units.some(u => u.status === 'pending' || u.status === 'failed')

  let mode: Mode
  if (plan.status === 'running')
    mode = { kind: 'active', label: t('review.banners.bootstrapRunning'), completed, total }
  else if (plan.status === 'deriving')
    mode = { kind: 'active', label: t('review.banners.derivingUnits'), completed, total }
  else if ((plan.status === 'failed' || plan.status === 'stopped') && unfinished)
    mode = { kind: 'resumable', completed, total }
  else
    mode = { kind: 'completed', completed, total }

  const actions = (label: string) => (
    <Button variant="ghost" size="sm" className="h-6 gap-1 text-2xs" onClick={onOpenBatch}>
      <Sparkles className="size-3" />
      {label}
    </Button>
  )

  if (mode.kind === 'active') {
    return (
      <TopBanner
        tone="batch"
        label={mode.label}
        detail={mode.total > 0
          ? t('review.banners.unitsProgress', { completed: mode.completed, total: mode.total })
          : ''}
        actions={actions(t('review.banners.viewProgressButton'))}
      />
    )
  }

  if (mode.kind === 'resumable') {
    return (
      <TopBanner
        tone="warning"
        label={t('review.banners.bootstrapIncomplete')}
        icon={AlertCircle}
        detail={t('review.banners.unitsDone', { completed: mode.completed, total: mode.total })}
        actions={actions(t('review.banners.resumeButton'))}
      />
    )
  }

  return (
    <TopBanner
      tone="reactor"
      label={t('review.banners.bootstrapComplete')}
      icon={CheckCircle2}
      spin={false}
      detail={t('review.banners.unitsProgress', { completed: mode.completed, total: mode.total })}
      actions={actions(t('review.banners.viewReportButton'))}
    />
  )
}
