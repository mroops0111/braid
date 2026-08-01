import { AlertCircle, CheckCircle2, Sparkles } from 'lucide-react'
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
    mode = { kind: 'active', label: 'Bootstrap Running', completed, total }
  else if (plan.status === 'deriving')
    mode = { kind: 'active', label: 'Deriving Units…', completed, total }
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
          ? (
              <>
                {mode.completed}
                {' / '}
                {mode.total}
                {' units'}
              </>
            )
          : ''}
        actions={actions('View Progress')}
      />
    )
  }

  if (mode.kind === 'resumable') {
    return (
      <TopBanner
        tone="warning"
        label="Bootstrap Incomplete"
        icon={AlertCircle}
        detail={(
          <>
            {mode.completed}
            {' / '}
            {mode.total}
            {' units done'}
          </>
        )}
        actions={actions('Resume')}
      />
    )
  }

  return (
    <TopBanner
      tone="reactor"
      label="Bootstrap Complete"
      icon={CheckCircle2}
      spin={false}
      detail={(
        <>
          {mode.completed}
          {' / '}
          {mode.total}
          {' units'}
        </>
      )}
      actions={actions('View Report')}
    />
  )
}
