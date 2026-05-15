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
    // until the telos-clarify skill wraps it into a Proposal and the
    // user reviews + applies. Don't refresh the graph here.
    source.addEventListener('clarify.answered', invalidateClarify)
    source.addEventListener('clarify.applied', () => {
      invalidateClarify()
      invalidateGraph()
    })
    source.addEventListener('clarify.skipped', invalidateClarify)
    source.addEventListener('source.synced', invalidateWorkspace)

    return () => {
      source.close()
    }
  }, [workspaceId, queryClient])
}

export type { WorkspaceEvent }
