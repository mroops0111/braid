import type { Workspace } from '@braidhq/schema'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { api, ApiError } from './api'
import { getTokenFor, LOCAL_REMOTE_ID, useActiveRemoteId, useRemotes } from './remotes'
import { getServerUrlFor } from './serverUrl'

export interface RemoteSummary {
  id: string
  name: string
  url: string
  isLocal: boolean
}

export type RemoteWorkspacesState =
  | { kind: 'loading' }
  | { kind: 'ok', workspaces: Workspace[] }
  | { kind: 'unauthenticated' }
  | { kind: 'error', message: string }

export interface RemoteWorkspacesResult {
  remote: RemoteSummary
  state: RemoteWorkspacesState
}

export interface ClassifyInput {
  hasToken: boolean
  isPending: boolean
  error: unknown
  data: { items: Workspace[] } | undefined
}

/**
 * Pure classifier, extracted so the state machine can be tested,
 * without standing up react-query.
 * It covers no-token, loading, 401, network error, and ok.
 * A 401 collapses to `unauthenticated`,
 * because the recourse is the same as having no token, to sign in.
 */
export function classifyRemoteResult(remote: RemoteSummary, input: ClassifyInput): RemoteWorkspacesResult {
  if (!remote.isLocal && !input.hasToken)
    return { remote, state: { kind: 'unauthenticated' } }
  if (input.isPending)
    return { remote, state: { kind: 'loading' } }
  if (input.error) {
    if (input.error instanceof ApiError && input.error.status === 401)
      return { remote, state: { kind: 'unauthenticated' } }
    const message = input.error instanceof Error ? input.error.message : 'Unreachable'
    return { remote, state: { kind: 'error', message } }
  }
  return { remote, state: { kind: 'ok', workspaces: input.data?.items ?? [] } }
}

/**
 * Fetch `/workspaces` from every configured remote in parallel.
 * Local is always queried,
 * since the X-Braid-User fallback covers the no-token sidecar case.
 * A remote without a stored token short-circuits to `unauthenticated`,
 * so the sidebar renders a Sign in affordance,
 * without ever issuing a doomed request.
 */
export function useAllRemoteWorkspaces(): RemoteWorkspacesResult[] {
  const remotes = useRemotes()
  const all: RemoteSummary[] = [
    { id: LOCAL_REMOTE_ID, name: 'Local', url: getServerUrlFor(LOCAL_REMOTE_ID), isLocal: true },
    ...remotes.map(r => ({ id: r.id, name: r.name, url: r.url, isLocal: false })),
  ]
  const queries = useQueries({
    queries: all.map(remote => ({
      queryKey: ['workspaces-at', remote.id] as const,
      queryFn: () => api.listWorkspacesAt(remote.id),
      retry: false,
      enabled: remote.isLocal || getTokenFor(remote.id) != null,
    })),
  })
  return all.map((remote, i) => {
    const query = queries[i]!
    return classifyRemoteResult(remote, {
      hasToken: getTokenFor(remote.id) != null,
      isPending: query.isPending,
      error: query.error,
      data: query.data,
    })
  })
}

/**
 * Clears the react-query cache whenever the active remote flips.
 * Without this, a switch leaves every workspace-scoped query stale.
 * It serves data from the previous server until its own TTL expires.
 */
export function useResetOnRemoteChange(): void {
  const queryClient = useQueryClient()
  const activeId = useActiveRemoteId()
  const prevRef = useRef(activeId)
  useEffect(() => {
    if (prevRef.current !== activeId) {
      queryClient.clear()
      prevRef.current = activeId
    }
  }, [activeId, queryClient])
}
