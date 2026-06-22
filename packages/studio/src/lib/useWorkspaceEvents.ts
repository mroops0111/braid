import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { workspaceEventsUrl } from './api'
import { queryKeys } from './queries'

/**
 * Workspace-scoped runtime events as sent by the server's SSE stream.
 * Keep this in sync with `packages/core/src/domain/events/WorkspaceEvent.ts` —
 * Studio only reads the discriminator to decide which query keys to
 * invalidate, so we don't lose anything by typing payloads loosely here.
 */
interface WorkspaceEvent {
  type:
    | 'run.started'
    | 'run.completed'
    | 'proposal.created'
    | 'proposal.applied'
    | 'proposal.rejected'
    | 'clarify.created'
    | 'clarify.answered'
    | 'clarify.applied'
    | 'clarify.skipped'
    | 'source.synced'
    | 'history.committed'
    | 'workspace.restored'
    | 'batch.started'
    | 'batch.unit.started'
    | 'batch.unit.completed'
    | 'batch.unit.failed'
    | 'batch.completed'
    | 'batch.stopped'
    | 'batch.failed'
    | 'batch.checkpoint.started'
    | 'batch.checkpoint.completed'
    | 'batch.checkpoint.failed'
    | 'reactor.dispatched'
    | 'reactor.completed'
    | 'reactor.throttled'
    | 'reactor.unit.started'
    | 'reactor.unit.completed'
    | 'reactor.checkpoint.started'
    | 'reactor.checkpoint.completed'
}

/**
 * Subscribe to `/workspaces/:id/events` and invalidate matching react-query
 * caches in real time. Mounts once per selected workspace and is reactively
 * teardown when the workspace changes (or the component unmounts), so we
 * never leak a second EventSource for the same workspace.
 *
 * Strategy: the SSE itself only delivers signals (one identifier each).
 * For every signal we re-fetch the relevant list / snapshot endpoint via
 * the existing react-query keys; the freshly-fetched value is what
 * downstream UI consumes. No state lives in this hook.
 */
export function useWorkspaceEvents(workspaceId: string | null): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!workspaceId)
      return
    const source = new EventSource(workspaceEventsUrl(workspaceId))

    const invalidateRuns = (): void => {
      queryClient.invalidateQueries({ queryKey: queryKeys.runs(workspaceId) })
    }
    const invalidateProposals = (): void => {
      queryClient.invalidateQueries({ queryKey: queryKeys.proposals(workspaceId) })
    }
    const invalidateClarify = (): void => {
      queryClient.invalidateQueries({ queryKey: queryKeys.clarify(workspaceId) })
    }
    const invalidateGraph = (): void => {
      queryClient.invalidateQueries({ queryKey: queryKeys.modelSnapshot(workspaceId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.nodes(workspaceId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.edges(workspaceId) })
      // Pre-validation results depend on the current graph; re-fetch
      // them after any mutation so the Proposals tab can't show stale
      // "no issues" against a snapshot that changed under it.
      queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId, 'proposals'], exact: false })
    }
    const invalidateWorkspace = (): void => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaceDetail(workspaceId) })
    }

    // run.completed implies the graph may have changed (the skill may
    // have applied operations via the proposal flow) — be liberal and
    // invalidate runs + proposals + graph.
    source.addEventListener('run.started', invalidateRuns)
    source.addEventListener('run.completed', () => {
      invalidateRuns()
      invalidateProposals()
      invalidateGraph()
    })
    source.addEventListener('proposal.created', invalidateProposals)
    source.addEventListener('proposal.applied', () => {
      invalidateProposals()
      invalidateGraph()
    })
    source.addEventListener('proposal.rejected', invalidateProposals)
    source.addEventListener('clarify.created', invalidateClarify)
    // `clarify.answered` is just a status update — graph stays untouched
    // until the braid-clarify skill wraps it into a Proposal and the
    // user reviews + applies. Don't refresh the graph here.
    source.addEventListener('clarify.answered', invalidateClarify)
    source.addEventListener('clarify.applied', () => {
      invalidateClarify()
      invalidateGraph()
    })
    source.addEventListener('clarify.skipped', invalidateClarify)
    source.addEventListener('source.synced', invalidateWorkspace)
    source.addEventListener('history.committed', () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.history(workspaceId) })
    })
    // Restore moved the working tree AND the storage backend; every
    // workspace-scoped query is potentially stale.
    source.addEventListener('workspace.restored', () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId], exact: false })
    })
    const invalidateBatch = (): void => {
      queryClient.invalidateQueries({ queryKey: queryKeys.batch(workspaceId) })
    }
    source.addEventListener('batch.started', invalidateBatch)
    source.addEventListener('batch.unit.started', invalidateBatch)
    source.addEventListener('batch.unit.completed', () => {
      invalidateBatch()
      invalidateProposals()
      invalidateClarify()
      invalidateGraph()
    })
    source.addEventListener('batch.unit.failed', invalidateBatch)
    source.addEventListener('batch.completed', invalidateBatch)
    source.addEventListener('batch.stopped', invalidateBatch)
    source.addEventListener('batch.failed', invalidateBatch)
    source.addEventListener('batch.checkpoint.started', invalidateBatch)
    source.addEventListener('batch.checkpoint.completed', () => {
      // Model run cross-links nodes & runs validators — graph can shift.
      invalidateBatch()
      invalidateProposals()
      invalidateGraph()
    })
    source.addEventListener('batch.checkpoint.failed', invalidateBatch)

    const invalidateReactorPasses = (): void => {
      queryClient.invalidateQueries({ queryKey: ['reactor-passes', workspaceId], exact: false })
    }
    const invalidatePassFinished = (): void => {
      // Per-option badges (extracted / stale) live behind the diff
      // endpoint; refresh them when the reactor finishes a pass so the
      // dropdown's freshness chips reflect the new ledger.
      queryClient.invalidateQueries({ queryKey: ['source-unit-diff', workspaceId], exact: false })
      // Reactor writes Proposals through the per-unit skill it dispatches.
      invalidateProposals()
      invalidateGraph()
      invalidateReactorPasses()
    }
    // Every reactor.* event mutates the pass record. The Activity page
    // is live-updating, so invalidate on every signal.
    source.addEventListener('reactor.dispatched', invalidateReactorPasses)
    source.addEventListener('reactor.unit.started', invalidateReactorPasses)
    source.addEventListener('reactor.unit.completed', invalidateReactorPasses)
    source.addEventListener('reactor.checkpoint.started', invalidateReactorPasses)
    source.addEventListener('reactor.checkpoint.completed', invalidateReactorPasses)
    source.addEventListener('reactor.completed', invalidatePassFinished)
    source.addEventListener('reactor.throttled', invalidateReactorPasses)

    return () => {
      source.close()
    }
  }, [workspaceId, queryClient])
}

export type { WorkspaceEvent }
