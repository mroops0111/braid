import type { BlockId, SkillEvent } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { collectBlocks, collectTurns } from '@/lib/blocks/collectBlocks'

function blockEvent(id: string, markdown: string): SkillEvent {
  return {
    type: 'block',
    id: id as BlockId,
    block: { call: 'showAnswer', audiences: [], markdown },
  }
}

describe('collectBlocks', () => {
  it('returns nothing for a run that rendered no blocks', () => {
    const events: SkillEvent[] = [
      { type: 'message', text: 'plain prose' },
      { type: 'thinking', text: 'considering' },
    ]

    expect(collectBlocks(events)).toEqual([])
  })

  it('keeps the order the blocks arrived in', () => {
    const events: SkillEvent[] = [
      blockEvent('block-1', 'first'),
      { type: 'message', text: 'noise between them' },
      blockEvent('block-2', 'second'),
    ]

    expect(collectBlocks(events).map(entry => entry.id)).toEqual(['block-1', 'block-2'])
  })

  it('drops a block replayed by a reconnect', () => {
    const events: SkillEvent[] = [
      blockEvent('block-1', 'first'),
      blockEvent('block-1', 'first'),
      blockEvent('block-2', 'second'),
    ]

    expect(collectBlocks(events)).toHaveLength(2)
  })
})

describe('collectTurns', () => {
  function started(runId: string, args: string): SkillEvent {
    return { type: 'started', runId: runId as never, skillId: 'braid:ask' as never, args, resumed: false, at: '2026-09-05T00:00:00Z' as never }
  }

  it('splits blocks at each question the reader asked', () => {
    const events: SkillEvent[] = [
      started('run-1', 'first question'),
      blockEvent('block-1', 'answer one'),
      started('run-2', 'follow-up question'),
      blockEvent('block-2', 'answer two'),
      blockEvent('block-3', 'answer three'),
    ]

    const turns = collectTurns(events)

    expect(turns.map(turn => turn.question)).toEqual(['first question', 'follow-up question'])
    expect(turns.map(turn => turn.blocks.length)).toEqual([1, 2])
  })

  it('keeps a block whose start event was lost, rather than dropping it', () => {
    const turns = collectTurns([blockEvent('block-1', 'orphan')])

    expect(turns).toHaveLength(1)
    expect(turns[0]?.question).toBeNull()
    expect(turns[0]?.blocks).toHaveLength(1)
  })

  it('drops a block replayed by a reconnect', () => {
    const events: SkillEvent[] = [
      started('run-1', 'q'),
      blockEvent('block-1', 'once'),
      blockEvent('block-1', 'again'),
    ]

    expect(collectTurns(events)[0]?.blocks).toHaveLength(1)
  })
})
