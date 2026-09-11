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
 */
export function collectTurns(events: readonly SkillEvent[]): readonly BlockTurn[] {
  const turns: BlockTurn[] = []
  const seen = new Set<string>()
  let current: { key: string, question: string | null, blocks: EmittedBlock[] } | null = null

  for (const event of events) {
    if (event.type === 'started') {
      current = { key: event.runId, question: event.args, blocks: [] }
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
