import type { Surface } from '@/components/CommandPalette'
import { useEffect } from 'react'

const SURFACE_VALUES: readonly Surface[] = ['actions', 'batch', 'clarifications', 'history', 'proposals', 'settings']

export interface UrlState {
  readonly workspaceId: string | null
  readonly surface: Surface | null
}

/**
 * The hash encodes the active workspace and surface.
 *   #/ws/<id>            workspace home (Graph)
 *   #/ws/<id>/<surface>  a workspace surface, Proposals, Clarification, Actions, Batch, History
 *   #/settings           account-level Settings, no workspace context
 *
 * Settings sits at the root because it is not workspace-scoped.
 * Editing the server connection list means the same thing,
 * regardless of which workspace you were last looking at.
 */
export function readUrl(): UrlState {
  const hash = typeof window === 'undefined' ? '' : window.location.hash
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  if (parts.length === 0)
    return { workspaceId: null, surface: null }
  if (parts[0] === 'settings')
    return { workspaceId: null, surface: 'settings' }
  if (parts[0] !== 'ws')
    return { workspaceId: null, surface: null }
  const workspaceId = parts[1] ?? null
  const candidate = parts[2]
  // 'settings' is not a workspace-scoped surface, so reject it here.
  // If someone hand-types #/ws/foo/settings,
  // we drop them at workspace home rather than render a confused mix.
  const surface = candidate
    && candidate !== 'settings'
    && (SURFACE_VALUES as readonly string[]).includes(candidate)
    ? candidate as Surface
    : null
  return { workspaceId, surface }
}

export function writeUrl(state: UrlState): void {
  if (typeof window === 'undefined')
    return
  const next = formatHash(state)
  if (window.location.hash === next)
    return
  // Use history.replaceState so the back button doesn't accumulate every nav.
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${next}`)
}

function formatHash(state: UrlState): string {
  if (state.surface === 'settings')
    return '#/settings'
  if (!state.workspaceId)
    return ''
  const tail = state.surface ? `/${state.surface}` : ''
  return `#/ws/${encodeURIComponent(state.workspaceId)}${tail}`
}

export function useUrlSync(state: UrlState): void {
  const { workspaceId, surface } = state
  useEffect(() => {
    writeUrl({ workspaceId, surface })
  }, [workspaceId, surface])
}
