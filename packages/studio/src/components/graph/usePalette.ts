import { createContext, useContext, useMemo } from 'react'
import { useOntology } from '@/lib/queries'
import { buildPalette, type OntologyPalette } from './ontologyPalette'

const FALLBACK_PALETTE = buildPalette(undefined)

/**
 * Provided by GraphCanvas; consumed by node cards, navigator rows,
 * detail-sheet badges, etc. Children get the palette without each
 * having to know the workspaceId.
 */
const PaletteContext = createContext<OntologyPalette | null>(null)

export const PaletteProvider = PaletteContext.Provider

/**
 * Resolve the palette for a workspace's active ontology. While the
 * ontology query is loading the palette returns muted fallbacks; once
 * it resolves all consumers re-render with authored colours.
 */
export function usePalette(workspaceId: string): OntologyPalette {
  const { data } = useOntology(workspaceId)
  return useMemo(() => buildPalette(data), [data])
}

/**
 * Read the active palette from context. Falls back to an empty
 * palette so isolated unit-tests / stories don't crash.
 */
export function usePaletteContext(): OntologyPalette {
  const palette = useContext(PaletteContext)
  return palette ?? FALLBACK_PALETTE
}
