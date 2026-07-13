import type { SourceUnit, SourceUnitDiff, SourceUnitObservation } from '@braidhq/schema'

function key(sourceId: string, path: string): string {
  return `${sourceId}::${path}`
}

/**
 * Pure partition: given the current set of on-disk units and the existing recorded states,
 * classify each unit as new / changed / unchanged,
 * and call out any state entries whose unit is no longer on disk (orphaned).
 *
 * Both inputs are scoped to a single workspace by the caller, this function does not filter on workspaceId.
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
    const k = key(unit.sourceId, unit.path)
    seen.add(k)
    const state = byKey.get(k)
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
