import type { ProposalId } from '@braidhq/schema'
import { createContext, useContext } from 'react'

/**
 * Cross-tab navigation for non-graph entities. Provided by `App.tsx`,
 * consumed by views (e.g. an applied Clarification footer) that want
 * to deep-link into another tab. Today only proposal focus is wired;
 * extend the shape when a second target lands.
 */
export interface TabNavigation {
  focusProposal: (id: ProposalId) => void
}

export const TabNavigationContext = createContext<TabNavigation | null>(null)

export function useTabNavigation(): TabNavigation | null {
  return useContext(TabNavigationContext)
}
