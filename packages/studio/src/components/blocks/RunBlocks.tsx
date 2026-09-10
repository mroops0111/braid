import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { collectBlocks } from '@/lib/blocks/collectBlocks'
import { summariseActivity } from '@/lib/blocks/runActivity'
import { EvidenceDetailContext, PendingOperationsContext, WorkspaceScopeContext } from '@/lib/blocks/WorkspaceScopeContext'
import { usePendingProposals } from '@/lib/queries'
import { runStore } from '@/lib/runStore'
import { useRun } from '@/lib/useRun'
import { renderBlock } from './renderBlock'
import { RunActivity } from './RunActivity'

/**
 * The reasoning behind a record, read from the run that produced it.
 *
 * A proposal is a list of operations and a clarification is a question,
 * and neither says why.
 * The run that made them showed its working in blocks,
 * so this replays that working beside the thing it produced,
 * using the same renderers the Ask surface uses,
 * rather than a second presentation of its own.
 *
 * Blocks arrive near the end of a long run,
 * so until then this shows what the stream has been carrying all along,
 * the agent's own narration and what it has read.
 * A pane that says nothing for four minutes reads as broken,
 * and the run was never actually silent.
 *
 * The run's own unapplied proposals ride along in context,
 * because a run that proposes drew its slice against the graph it asked for,
 * rather than the graph as it stands.
 * Only this run's, so a block is never drawn over a change,
 * that some other run happens to have waiting.
 */
export function RunBlocks({ workspaceId, runId, heading, note }: {
  workspaceId: string
  runId: string | undefined
  /** Overrides the heading, for a caller whose run means something else. */
  heading?: string
  /** A line above the blocks, where they need framing to be read correctly. */
  note?: string
}) {
  const { t } = useTranslation()
  const run = useRun(workspaceId, runId ?? null)
  const proposals = usePendingProposals(workspaceId)
  const pending = useMemo(
    () => (proposals.data?.items ?? [])
      .filter(proposal => proposal.skillRunId === runId)
      .flatMap(proposal => proposal.operations),
    [proposals.data, runId],
  )

  useEffect(() => {
    if (runId)
      runStore.loadRun(workspaceId, runId, 'inbox')
  }, [workspaceId, runId])

  if (!runId)
    return null
  const events = run?.events ?? []
  const blocks = collectBlocks(events)
  const running = run?.phase === 'streaming'
  const activity = summariseActivity(events)

  return (
    <WorkspaceScopeContext value={workspaceId}>
      <PendingOperationsContext value={pending}>
        <EvidenceDetailContext value="full">
          <section className="flex flex-col gap-3 border-b border-border px-5 py-4">
            <h2 className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
              {heading ?? t('inbox.reasoning')}
            </h2>
            {note && <p className="text-2xs text-muted-foreground">{note}</p>}
            {running && <RunActivity activity={activity} />}
            {blocks.map(({ id, block }) => (
              <div key={id}>{renderBlock(block)}</div>
            ))}
            {blocks.length === 0 && !running && events.length === 0 && (
              <p className="text-xs text-muted-foreground">{t('inbox.reasoningLoading')}</p>
            )}
          </section>
        </EvidenceDetailContext>
      </PendingOperationsContext>
    </WorkspaceScopeContext>
  )
}
