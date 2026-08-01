import type { OntologyResponse } from '@braidhq/schema'
import type { GraphFilters } from './GraphNavigator'
import { useEffect, useRef } from 'react'

/**
 * Seed the type-filter whitelist from the ontology,
 * once per workspace and mode.
 * Two seeding strategies:
 *   - `defaultVisible` (graph tab): only the high-level structural types,
 *     the ontology marks `defaultVisible`.
 *     Falls back to all types when the ontology declares no defaults,
 *     so the strict whitelist filter does not render an empty graph.
 *   - `all` (proposal preview): every declared type,
 *     so the reviewer sees the full diff impact without clicking chips.
 *
 * The composite ref key `workspaceId:mode` lets the seed re-run,
 * when the user switches between the tab and a proposal preview.
 * It stays sticky against refetches inside the same mode,
 * so manual filter edits are not clobbered.
 */
export function useFilterSeed(
  ontology: OntologyResponse | undefined,
  workspaceId: string,
  setFilters: (update: (prev: GraphFilters) => GraphFilters) => void,
  mode: 'defaultVisible' | 'all' = 'defaultVisible',
): void {
  const seededRef = useRef<string | null>(null)
  useEffect(() => {
    if (!ontology)
      return
    const key = `${workspaceId}:${mode}`
    if (seededRef.current === key)
      return
    const all = ontology.nodeTypes.map(d => d.id)
    const seed = mode === 'all'
      ? all
      : (() => {
          const defaults = ontology.nodeTypes.filter(d => d.defaultVisible).map(d => d.id)
          return defaults.length > 0 ? defaults : all
        })()
    setFilters(f => ({ ...f, types: seed }))
    seededRef.current = key
  }, [ontology, workspaceId, mode, setFilters])
}
