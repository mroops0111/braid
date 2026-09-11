import { useEffect } from 'react'
import { readStats } from '@/lib/blocks/runStats'
import { runStore } from '@/lib/runStore'
import { useRun } from '@/lib/useRun'
import { RunCost } from './blocks/RunCost'
import { SkillTranscript } from './SkillTranscript'

/**
 * One run's account, whole.
 *
 * Read from the stream, live while the run is going,
 * and replayed once it is over, which is the same events either way.
 * A run that carries another on opens holding that run's account,
 * so the thread reads in order from the first thing asked to the last done,
 * however many processes it took.
 */
export function RunTranscript({ workspaceId, runId }: { workspaceId: string, runId: string | undefined }) {
  const run = useRun(workspaceId, runId ?? null)

  useEffect(() => {
    if (runId)
      runStore.loadRun(workspaceId, runId, 'inbox')
  }, [workspaceId, runId])

  if (!runId)
    return null
  const events = run?.events ?? []

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SkillTranscript events={[...events]} error={run?.error ?? null} running={run?.phase === 'streaming'} />
      <RunCost stats={readStats(events)} />
    </div>
  )
}
