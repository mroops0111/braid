import { useMutation } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useRuns } from '@/lib/queries'
import { TopBanner } from './TopBanner'
import { Button } from './ui/button'

interface InFlightRunBannerProps {
  workspaceId: string | null
  /**
   * Surfaces that render the run's log themselves (Actions or Batch).
   * Pass `true` to suppress the banner there,
   * so the user is not shown two competing "still running" indicators.
   */
  suppress?: boolean
}

/**
 * Top-of-app banner that surfaces in-flight skill runs,
 * when the active surface does not already show the log.
 * Reads the runs list, kept live by `useWorkspaceEvents`,
 * and shows the most recent run that has no `completedAt`.
 *
 * Cancel POSTs `/runs/:id/cancel`, which SIGTERMs the claude subprocess.
 * The drain loop then emits `completed` with the actual exit code,
 * and `run.completed` flows through the event bus as usual.
 */
export function InFlightRunBanner({ workspaceId, suppress }: InFlightRunBannerProps) {
  const { data } = useRuns(workspaceId ?? undefined)
  const active = data?.items.find(r => !r.completedAt)

  if (!workspaceId || !active || suppress)
    return null

  return <ActiveBanner workspaceId={workspaceId} runId={active.runId} skillId={active.skillId} startedAt={active.startedAt} />
}

function ActiveBanner({ workspaceId, runId, skillId, startedAt }: {
  workspaceId: string
  runId: string
  skillId: string
  startedAt: string
}) {
  const elapsed = useElapsed(startedAt)
  const cancel = useMutation({
    mutationFn: () => api.cancelRun(workspaceId, runId),
  })

  return (
    <TopBanner
      tone="run"
      label={`/${skillId}`}
      detail={`running… ${elapsed}s elapsed`}
      actions={(
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 text-[11px]"
          disabled={cancel.isPending}
          onClick={() => cancel.mutate()}
        >
          <X className="size-3" />
          {cancel.isPending ? 'Cancelling…' : 'Cancel'}
        </Button>
      )}
    />
  )
}

function useElapsed(startedAt: string): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  return Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000))
}
