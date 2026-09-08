import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { collectBlocks } from '@/lib/blocks/collectBlocks'
import { EvidenceDetailContext, PendingOperationsContext, WorkspaceScopeContext } from '@/lib/blocks/WorkspaceScopeContext'
import { usePendingProposals } from '@/lib/queries'
import { runStore } from '@/lib/runStore'
import { useRun } from '@/lib/useRun'
import { renderBlock } from './renderBlock'

/**
 * The reasoning behind a record, read from the run that produced it.
 *
 * A proposal is a list of operations and a clarification is a question, and
 * neither says why. The run that made them showed its working in blocks, so
 * this replays that working beside the thing it produced, using the same
 * renderers the Ask surface uses rather than a second presentation of its own.
 *
 * Renders nothing at all when the run emitted no blocks, which is every run by
 * a skill that has not adopted the protocol. Those still have their transcript.
 *
 * The run's own unapplied proposals ride along in context, because a run that
 * proposes drew its slice against the graph it was asking for, not the graph
 * as it stands. Only this run's, so a block is never drawn over a change some
 * other run happens to have waiting.
 */
export function RunBlocks({ workspaceId, runId }: { workspaceId: string, runId: string | undefined }) {
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
  const blocks = collectBlocks(run?.events ?? [])
  // A long run replays in seconds, not instantly, and rendering nothing until
  // it lands reads as a broken pane rather than a loading one. Silence is only
  // right once the run has finished and turned out to have nothing to show.
  const settled = run?.phase === 'done' || run?.phase === 'error'
  if (blocks.length === 0 && settled)
    return null

  return (
    <WorkspaceScopeContext value={workspaceId}>
      <PendingOperationsContext value={pending}>
        <EvidenceDetailContext value="full">
          <section className="flex flex-col gap-3 border-b border-border px-5 py-4">
            <h2 className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('inbox.reasoning')}
            </h2>
            {blocks.length === 0
              ? <p className="text-xs text-muted-foreground">{t('inbox.reasoningLoading')}</p>
              : blocks.map(({ id, block }) => (
                  <div key={id}>{renderBlock(block)}</div>
                ))}
          </section>
        </EvidenceDetailContext>
      </PendingOperationsContext>
    </WorkspaceScopeContext>
  )
}
