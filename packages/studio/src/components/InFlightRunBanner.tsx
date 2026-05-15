import { useMutation } from '@tanstack/react-query'
import { Loader2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useRuns } from '@/lib/queries'
import { Button } from './ui/button'

interface InFlightRunBannerProps {
  workspaceId: string | null
}

/**
 * Top-of-app banner that surfaces in-flight skill runs no matter which
 * tab the user is on. Reads the runs list (kept live by `useWorkspaceEvents`)
 * and shows the most recent run that has no `completedAt`. Hidden when
 * nothing is running.
 *
 * Includes a cancel button — POSTs `/runs/:id/cancel`, which SIGTERMs the
 * claude subprocess. The drain loop then emits `completed` with the actual
 * exit code and `run.completed` flows through the event bus as usual, so
 * the banner disappears via the normal invalidation path.
 */
export function InFlightRunBanner({ workspaceId }: InFlightRunBannerProps) {
  const { data } = useRuns(workspaceId ?? undefined)
  const active = data?.items.find(r => !r.completedAt)

  if (!workspaceId || !active)
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
    <div className="flex items-center gap-3 border-b border-primary/30 bg-primary/5 px-4 py-1.5 text-xs">
      <Loader2 className="size-3 animate-spin text-primary" />
      <span className="font-mono text-foreground">{`/${skillId}`}</span>
      <span className="text-muted-foreground">{`running… ${elapsed}s elapsed`}</span>
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto h-6 gap-1 text-[11px]"
        disabled={cancel.isPending}
        onClick={() => cancel.mutate()}
      >
        <X className="size-3" />
        {cancel.isPending ? 'Cancelling…' : 'Cancel'}
      </Button>
    </div>
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
