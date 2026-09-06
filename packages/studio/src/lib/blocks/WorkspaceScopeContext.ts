import type { EvidenceDetail } from '@braidhq/schema'
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

/**
 * How much of a reference the current reader wants.
 *
 * The audience decides the depth, not which conclusions exist, so a reader who
 * does not want line numbers still sees every finding. `full` is the default,
 * because a workspace that declares no audiences hides nothing.
 */
export const EvidenceDetailContext = createContext<EvidenceDetail>('full')

export function useEvidenceDetail(): EvidenceDetail {
  return useContext(EvidenceDetailContext)
}
