import type { SkillEvent } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { formatStats, readStats } from '@/lib/blocks/runStats'

describe('readStats', () => {
  // Null rather than zeroes, which is the whole of a live run,
  // and zeroes would read as a finished run that cost nothing.
  it('reports nothing until the run says what it spent', () => {
    expect(readStats([{ type: 'message', text: 'working' }])).toBeNull()
  })

  it('reports what one usage event carried', () => {
    const events: SkillEvent[] = [{ type: 'usage', turns: 3, durationMs: 1000, costUsd: 0.25 }]
    expect(readStats(events)).toEqual({ turns: 3, durationMs: 1000, costUsd: 0.25 })
  })

  // A run can report more than once, and the last word is the one that counts.
  it('lets a later event overwrite what an earlier one said', () => {
    const events: SkillEvent[] = [
      { type: 'usage', turns: 1, costUsd: 0.1 },
      { type: 'usage', turns: 4 },
    ]
    expect(readStats(events)).toEqual({ turns: 4, costUsd: 0.1 })
  })

  // A run that reported an empty usage still reported.
  // An answer of "nothing recorded" is not the same as "not finished".
  it('reports an empty reading rather than nothing when the run sent one', () => {
    expect(readStats([{ type: 'usage' }])).toEqual({})
  })
})

describe('formatStats', () => {
  it('leaves out what the run never reported', () => {
    expect(formatStats({ turns: 2 })).toBe('2 turns')
    expect(formatStats({})).toBe('')
  })

  it('reads a duration in minutes and a cost in dollars', () => {
    expect(formatStats({ turns: 2, durationMs: 90_000, costUsd: 1.5 })).toBe('2 turns · 1.5m · $1.50')
  })

  // Zero is a reading, not a missing one.
  it('shows a zero cost rather than hiding it', () => {
    expect(formatStats({ costUsd: 0 })).toBe('$0.00')
  })
})
