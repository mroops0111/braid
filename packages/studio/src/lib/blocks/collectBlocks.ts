import type { EmittedBlock, SkillEvent } from '@braidhq/schema'

/**
 * The blocks a run has rendered, in the order they arrived.
 *
 * No view-framework imports here on purpose.
 * A surface decides whether this sequence becomes a scrolling answer,
 * a board, or a printed page,
 * and a second consumer of the stream should take this file as it stands.
 */
export function collectBlocks(events: readonly SkillEvent[]): readonly EmittedBlock[] {
  const blocks: EmittedBlock[] = []
  const seen = new Set<string>()
  for (const event of events) {
    // A reconnect replays persisted events before tailing live ones,
    // so the same block can arrive twice across one reconnect.
    if (event.type !== 'block' || seen.has(event.id))
      continue
    seen.add(event.id)
    blocks.push({ id: event.id, block: event.block })
  }
  return blocks
}

const EMPTY_RUN_IDS: ReadonlySet<string> = new Set<string>()

/** Blocks that arrived under one question, in the order the run emitted them. */
export interface BlockTurn {
  readonly key: string
  readonly question: string | null
  readonly blocks: readonly EmittedBlock[]
}

/**
 * The same blocks, split at each question the reader asked.
 *
 * A conversation concatenates its turns,
 * so without this a follow-up's blocks stack under the first question,
 * and stop being attributable.
 *
 * A correction is the same turn seen through a second process,
 * and what it was told is the gap it must close rather than a question,
 * so it joins the turn it carries on instead of opening one.
 * A caller holding the run records names those runs in `carriedOn`,
 * for a log whose events do not carry the link themselves.
 */
export function collectTurns(
  events: readonly SkillEvent[],
  carriedOn: ReadonlySet<string> = EMPTY_RUN_IDS,
): readonly BlockTurn[] {
  const turns: BlockTurn[] = []
  const seen = new Set<string>()
  let current: { key: string, question: string | null, blocks: EmittedBlock[] } | null = null

  for (const event of events) {
    if (event.type === 'started') {
      const carries = Boolean(event.continues) || carriedOn.has(event.runId)
      if (carries && current)
        continue
      // A correction that opens a replay has no turn to join,
      // and heading it with what it was told would print the gap as a question.
      current = { key: event.runId, question: carries ? null : event.args, blocks: [] }
      turns.push(current)
      continue
    }
    if (event.type !== 'block' || seen.has(event.id))
      continue
    seen.add(event.id)
    // A block with no preceding `started` belongs to a replay that lost its head.
    if (!current) {
      current = { key: `orphan-${event.id}`, question: null, blocks: [] }
      turns.push(current)
    }
    current.blocks.push({ id: event.id, block: event.block })
  }
  return turns
}
