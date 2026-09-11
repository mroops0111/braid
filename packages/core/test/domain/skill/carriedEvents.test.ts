import type { SkillEvent } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { carriedEvents } from '../../../src/index.js'

const THREAD: SkillEvent[] = [
  { type: 'started', runId: 'skill-run-1' as never, skillId: 'ddd:extract' as never, args: 'unit/', resumed: false, at: '2026-09-10T00:00:00.000Z' as never },
  { type: 'session-started', sessionId: 'sess-1' },
  { type: 'message', text: 'Reading the document.' },
  { type: 'tool-call', tool: 'Read', args: { path: 'unit/index.md' }, toolCallId: 'c1' },
  { type: 'tool-result', toolCallId: 'c1', output: 'a document', isError: false },
  { type: 'usage', costUsd: 1.2, durationMs: 900, turns: 4 },
  { type: 'completed', runId: 'skill-run-1' as never, exitCode: 0, at: '2026-09-10T00:05:00.000Z' as never },
]

describe('carriedEvents', () => {
  // The thread is what a reader follows, so all of it travels.
  // What was asked, what was read, and what the agent said about it.
  it('carries the account of the work', () => {
    expect(carriedEvents(THREAD).map(event => event.type))
      .toEqual(['started', 'message', 'tool-call', 'tool-result'])
  })

  // Copying these would have the new run report the earlier ending,
  // and bill its spend a second time.
  it('leaves the earlier process its own bookkeeping', () => {
    const types = carriedEvents(THREAD).map(event => event.type)
    expect(types).not.toContain('completed')
    expect(types).not.toContain('usage')
    expect(types).not.toContain('session-started')
  })

  it('keeps the order it was given', () => {
    const carried = carriedEvents(THREAD)
    expect(carried[0]!.type).toBe('started')
    expect(carried.at(-1)!.type).toBe('tool-result')
  })
})
