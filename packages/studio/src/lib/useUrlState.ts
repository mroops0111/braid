import type { Surface } from '@/components/CommandPalette'
import { useEffect } from 'react'

const SURFACE_VALUES: readonly Surface[] = ['actions', 'batch', 'clarify', 'history', 'proposals']

export interface UrlState {
  readonly workspaceId: string | null
  readonly surface: Surface | null
}

// Hash-based: #/ws/<id>(/<surface>)?. SPA-friendly and works under the Tauri
// shell without server-side rewrites.
export function readUrl(): UrlState {
  const hash = typeof window === 'undefined' ? '' : window.location.hash
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  if (parts.length === 0 || parts[0] !== 'ws')
    return { workspaceId: null, surface: null }
  const workspaceId = parts[1] ?? null
  const candidate = parts[2]
  const surface = candidate && (SURFACE_VALUES as readonly string[]).includes(candidate)
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
