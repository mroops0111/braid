import type { OntologyResponse } from '@braidhq/schema'
import type { GraphFilters } from './GraphNavigator'
import { useEffect, useRef } from 'react'

/**
 * Seed the type-filter whitelist from the ontology's `defaultVisible`
 * descriptors, once per workspace. The ref guard prevents a refetch
 * from clobbering the user's later filter edits; switching workspace
 * re-seeds because the ref's last-seen id no longer matches.
 *
 * Falls back to "all types" when the ontology declares no
 * defaultVisible — under the strict-whitelist filter convention an
 * empty seed would render an empty graph with no hint that the user
 * needs to click chips.
 */
export function useFilterSeed(
  ontology: OntologyResponse | undefined,
  workspaceId: string,
  setFilters: (update: (prev: GraphFilters) => GraphFilters) => void,
): void {
  const seededRef = useRef<string | null>(null)
  useEffect(() => {
    if (!ontology || seededRef.current === workspaceId)
      return
    const defaults = ontology.nodeTypes.filter(d => d.defaultVisible).map(d => d.id)
    const seed = defaults.length > 0 ? defaults : ontology.nodeTypes.map(d => d.id)
    setFilters(f => ({ ...f, types: seed }))
    seededRef.current = workspaceId
  }, [ontology, workspaceId, setFilters])
}
