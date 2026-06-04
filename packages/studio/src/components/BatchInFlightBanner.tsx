import { AlertCircle, CheckCircle2, Loader2, Sparkles } from 'lucide-react'
import { useBatchStatus } from '@/lib/queries'
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

// Cross-surface entry to the Batch view; hidden on the Batch surface itself and when no plan exists.
export function BatchInFlightBanner({ workspaceId, onOpenBatch, suppress }: BatchInFlightBannerProps) {
  const { data: plan } = useBatchStatus(workspaceId ?? undefined)
  if (!plan || suppress || plan.status === 'idle')
    return null

  const completed = plan.units.filter(u => u.status === 'completed').length
  const total = plan.units.length
  const unfinished = plan.units.some(u => u.status === 'pending' || u.status === 'failed')

  let mode: Mode
  if (plan.status === 'running')
    mode = { kind: 'active', label: 'Bootstrap Running', completed, total }
  else if (plan.status === 'scanning')
    mode = { kind: 'active', label: 'Scanning Codebase…', completed, total }
  else if ((plan.status === 'failed' || plan.status === 'stopped') && unfinished)
    mode = { kind: 'resumable', completed, total }
  else
    mode = { kind: 'completed', completed, total }

  if (mode.kind === 'active') {
    return (
      <div className="flex items-center gap-3 border-b border-primary/30 bg-primary/5 px-4 py-1.5 text-xs">
        <Loader2 className="size-3 animate-spin text-primary" />
        <span className="font-medium text-foreground">{mode.label}</span>
        {mode.total > 0 && (
          <span className="text-muted-foreground">
            {mode.completed}
            {' / '}
            {mode.total}
            {' units'}
          </span>
        )}
        <Button variant="ghost" size="sm" className="ml-auto h-6 gap-1 text-[11px]" onClick={onOpenBatch}>
          <Sparkles className="size-3" />
          View Progress
        </Button>
      </div>
    )
  }

  if (mode.kind === 'resumable') {
    return (
      <div className="flex items-center gap-3 border-b border-amber-500/30 bg-amber-500/5 px-4 py-1.5 text-xs">
        <AlertCircle className="size-3 text-amber-600 dark:text-amber-300" />
        <span className="font-medium text-foreground">Bootstrap Incomplete</span>
        <span className="text-muted-foreground">
          {mode.completed}
          {' / '}
          {mode.total}
          {' units done'}
        </span>
        <Button variant="ghost" size="sm" className="ml-auto h-6 gap-1 text-[11px]" onClick={onOpenBatch}>
          <Sparkles className="size-3" />
          Resume
        </Button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 border-b border-emerald-500/30 bg-emerald-500/5 px-4 py-1.5 text-xs">
      <CheckCircle2 className="size-3 text-emerald-600 dark:text-emerald-300" />
      <span className="font-medium text-foreground">Bootstrap Complete</span>
      <span className="text-muted-foreground">
        {mode.completed}
        {' / '}
        {mode.total}
        {' units'}
      </span>
      <Button variant="ghost" size="sm" className="ml-auto h-6 gap-1 text-[11px]" onClick={onOpenBatch}>
        <Sparkles className="size-3" />
        View Report
      </Button>
    </div>
  )
}
