import type { EvidenceSupport, FindingSide } from '@braidhq/schema'

/**
 * How strongly a finding's own references carry it.
 *
 * A disagreement is only as good as both halves of it, so the weaker side
 * decides. Provenance is the axis that matters, because a location the graph
 * already cites has survived a review and one this run opened has not.
 *
 * - `corroborated`: every side rests on at least one reference the graph cites.
 * - `partial`: every side has a reference, at least one of them agent-read.
 * - `thin`: at least one side has no reference at all.
 */
export function evidenceSupport(sides: readonly FindingSide[]): EvidenceSupport {
  if (sides.some(side => side.refs.length === 0))
    return 'thin'
  return sides.every(side => side.refs.some(ref => ref.provenance === 'graph'))
    ? 'corroborated'
    : 'partial'
}
