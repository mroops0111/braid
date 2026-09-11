import type { BlockRef, NodeId, RenderBlock } from '@braidhq/schema'

/**
 * Every reference a block makes, wherever its own shape happens to keep them.
 *
 * One block puts them at the top,
 * another puts a set on each side of a disagreement, a third on every cell.
 * A caller checking what a block claims should not have to know which.
 */
export function refsOf(block: RenderBlock): BlockRef[] {
  switch (block.call) {
    case 'showEvidence':
      return [...block.refs]
    case 'showFinding':
      return block.sides.flatMap(side => [...side.refs])
    case 'showMatrix':
      return block.cells.flatMap(cell => [...cell.refs])
    case 'showTrace':
      return [...block.read]
    // These carry no references of their own.
    // Prose, a drawing, and a set of nodes to draw,
    // each of which rests on the blocks around it.
    case 'showAnswer':
    case 'showDiagram':
    case 'showSubgraph':
      return []
    default: {
      const exhaustive: never = block
      throw new Error(`Unhandled block: ${JSON.stringify(exhaustive)}`)
    }
  }
}

/**
 * What a block claims the graph already says.
 *
 * A ref declares where it came from.
 * `agent` is the run's own reading and rests on nothing but itself,
 * so there is nothing here to settle.
 * `graph` says the model holds this,
 * and that is the one claim this side can check.
 * Unchecked, a reader is shown a citation to something never there,
 * which is worse than no citation because it reads as corroboration.
 *
 * A graph ref that names no node is returned too,
 * under the location it does carry.
 * It makes the same claim while withholding the one thing that would test it,
 * so treating it as nothing to check would leave the claim standing,
 * and the check trivially avoidable.
 *
 * What a block draws is not part of this.
 * A run proposing a new subsystem draws it before anybody has applied it,
 * and refusing that would refuse the ordinary case.
 */
export interface GraphCitation {
  /** Absent when the ref claims the graph without naming what it took. */
  readonly nodeId?: NodeId
  /** What to call it when telling the run what went wrong. */
  readonly describedAs: string
}

export function graphCitations(block: RenderBlock): GraphCitation[] {
  return refsOf(block)
    .filter(ref => ref.provenance === 'graph')
    .map(ref => (ref.nodeId === undefined
      ? { describedAs: `${ref.reference.sourceId}/${ref.reference.location.uri}` }
      : { nodeId: ref.nodeId, describedAs: ref.nodeId }))
}
