import type { ReferenceRegistry } from './referenceRegistry'
import { createContext, useContext } from 'react'

export const ReferenceRegistryContext = createContext<ReferenceRegistry | null>(null)

/** Null outside a provider, so a tag degrades to plain text instead of throwing. */
export function useReferenceRegistry(): ReferenceRegistry | null {
  return useContext(ReferenceRegistryContext)
}
