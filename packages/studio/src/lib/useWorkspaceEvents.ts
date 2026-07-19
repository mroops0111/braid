import type { WorkspaceEvent } from '@braidhq/schema'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { workspaceEventsUrl } from './api'
import { queryKeys } from './queries'

/**
 * Subscribe to `/workspaces/:id/events` and invalidate matching react-query caches in real time.
 * Mounts once per selected workspace and is reactively teardown when the workspace changes (or the component unmounts),
 * so we never leak a second EventSource for the same workspace.
 *
 * Strategy: the SSE itself only delivers signals (one identifier each).
 * For every signal we re-fetch the relevant list / snapshot endpoint via the existing react-query keys,
 * the freshly-fetched value is what downstream UI consumes. No state lives in this hook.
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
    const invalidateClarification = (): void => {
      queryClient.invalidateQueries({ queryKey: queryKeys.clarifications(workspaceId) })
    }
    const invalidateGraph = (): void => {
      queryClient.invalidateQueries({ queryKey: queryKeys.modelSnapshot(workspaceId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.nodes(workspaceId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.edges(workspaceId) })
      // Pre-validation results depend on the current graph. Re-fetch after any mutation,
      // so the Proposals tab can't show stale "no issues" after a change.
      queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId, 'proposals'], exact: false })
    }
    const invalidateWorkspace = (): void => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaceDetail(workspaceId) })
    }

    // run.completed implies the graph may have changed. The skill may have applied operations via the proposal flow,
    // so be liberal and invalidate runs, proposals, and graph.
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
    source.addEventListener('clarification.created', invalidateClarification)
    // `clarification.answered` is only a status update, no graph change yet.
    // braid-clarify later wraps it into a Proposal the user reviews. Applying that Proposal changes the graph,
    // not this event.
    source.addEventListener('clarification.answered', invalidateClarification)
    source.addEventListener('clarification.applied', () => {
      invalidateClarification()
      invalidateGraph()
    })
    source.addEventListener('clarification.skipped', invalidateClarification)
    source.addEventListener('source.synced', invalidateWorkspace)
    source.addEventListener('history.committed', () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.history(workspaceId) })
    })
    // Restore moved the working tree and the storage backend. Every workspace-scoped query is potentially stale.
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
      invalidateClarification()
      invalidateGraph()
    })
    source.addEventListener('batch.unit.failed', invalidateBatch)
    source.addEventListener('batch.completed', invalidateBatch)
    source.addEventListener('batch.stopped', invalidateBatch)
    source.addEventListener('batch.failed', invalidateBatch)
    source.addEventListener('batch.checkpoint.started', invalidateBatch)
    source.addEventListener('batch.checkpoint.completed', () => {
      // Model run cross-links nodes and runs validators, the graph can shift.
      invalidateBatch()
      invalidateProposals()
      invalidateGraph()
    })
    source.addEventListener('batch.checkpoint.failed', invalidateBatch)

    const invalidateReactorCycles = (): void => {
      queryClient.invalidateQueries({ queryKey: ['reactor-cycles', workspaceId], exact: false })
    }
    const invalidateCycleFinished = (): void => {
      // Per-option badges (extracted / stale) live behind the diff endpoint.
      // Refresh them when the reactor finishes a cycle, so the dropdown's freshness chips reflect the new ledger.
      queryClient.invalidateQueries({ queryKey: ['source-unit-diff', workspaceId], exact: false })
      // Reactor writes Proposals through the per-unit skill it dispatches.
      invalidateProposals()
      invalidateGraph()
      invalidateReactorCycles()
    }
    // Every reactor.* event mutates the cycle record. The Activity page is live, so invalidate on every signal.
    source.addEventListener('reactor.dispatched', invalidateReactorCycles)
    source.addEventListener('reactor.unit.started', invalidateReactorCycles)
    source.addEventListener('reactor.unit.completed', invalidateReactorCycles)
    source.addEventListener('reactor.checkpoint.started', invalidateReactorCycles)
    source.addEventListener('reactor.checkpoint.completed', invalidateReactorCycles)
    source.addEventListener('reactor.completed', invalidateCycleFinished)
    source.addEventListener('reactor.throttled', invalidateReactorCycles)

    return () => {
      source.close()
    }
  }, [workspaceId, queryClient])
}

export type { WorkspaceEvent }
