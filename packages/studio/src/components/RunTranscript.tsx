import { readStats } from '@/lib/blocks/runStats'
import { useRunEvents } from '@/lib/queries'
import { RunCost } from './blocks/RunCost'
import { SkillTranscript } from './SkillTranscript'

/**
 * One run's account, whole.
 *
 * Read from Braid's own log rather than from the live stream. The stream
 * speaks AG-UI, which has no field for what a run was told, so a prompt does
 * not survive the trip and a reader lands on work with no sight of the
 * instruction behind it. The log has everything, and a run that carries
 * another on opens holding that run's account, so the thread reads in order
 * from the first thing asked to the last thing done however many processes it
 * took.
 */
export function RunTranscript({ workspaceId, runId }: { workspaceId: string, runId: string | undefined }) {
  const { data, error } = useRunEvents(workspaceId, runId)

  if (!runId)
    return null
  const events = data?.items ?? []

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SkillTranscript
        events={events}
        error={error instanceof Error ? error.message : null}
        running={data?.active ?? false}
      />
      <RunCost stats={readStats(events)} />
    </div>
  )
}
