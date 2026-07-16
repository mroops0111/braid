import type { SourceUnit, SourceUnitDiff, SourceUnitObservation } from '@braidhq/schema'

function key(sourceId: string, path: string): string {
  return `${sourceId}::${path}`
}

/**
 * Pure partition of the on-disk units against the existing recorded states.
 * Classifies each unit as new / changed / unchanged,
 * and calls out any state entries whose unit is gone from disk (orphaned).
 *
 * Both inputs are scoped to a single workspace by the caller.
 * This function does not filter on workspaceId.
 */
export function computeSourceUnitDiff(
  states: readonly SourceUnitObservation[],
  units: readonly SourceUnit[],
): SourceUnitDiff {
  const byKey = new Map<string, SourceUnitObservation>()
  for (const state of states)
    byKey.set(key(state.sourceId, state.path), state)

  const seen = new Set<string>()
  const result: SourceUnitDiff = {
    new: [],
    changed: [],
    unchanged: [],
    orphaned: [],
  }
  for (const unit of units) {
    const compositeKey = key(unit.sourceId, unit.path)
    seen.add(compositeKey)
    const state = byKey.get(compositeKey)
    if (!state) {
      result.new.push(unit)
      continue
    }
    if (state.lastObservedSha === unit.sha)
      result.unchanged.push(unit)
    else
      result.changed.push(unit)
  }
  for (const [k, state] of byKey.entries()) {
    if (!seen.has(k))
      result.orphaned.push(state)
  }
  return result
}
