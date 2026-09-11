import type { ProposalId } from '@braidhq/schema'
import { createContext, useContext } from 'react'

/**
 * Cross-tab navigation for non-graph entities. Provided by `App.tsx`,
 * consumed by views such as an applied Clarification footer,
 * that want to deep-link into another tab.
 */
export interface TabNavigation {
  focusProposal: (id: ProposalId) => void
  /** The queue itself, for work that names no single record to focus. */
  openInbox: () => void
}

export const TabNavigationContext = createContext<TabNavigation | null>(null)

export function useTabNavigation(): TabNavigation | null {
  return useContext(TabNavigationContext)
}
