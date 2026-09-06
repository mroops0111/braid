import { createContext, useContext } from 'react'

/**
 * The workspace a block belongs to, for the few renderers that must ask the
 * server something about it. Null outside a provider, so a block still renders
 * as plain content instead of throwing.
 */
export const WorkspaceScopeContext = createContext<string | null>(null)

export function useWorkspaceScope(): string | null {
  return useContext(WorkspaceScopeContext)
}
