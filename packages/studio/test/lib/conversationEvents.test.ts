import type { SkillEvent } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { ownEvents } from '@/lib/conversationEvents'

function started(runId: string, args: string): SkillEvent {
  return { type: 'started', runId: runId as never, skillId: 'braid:ask' as never, args, resumed: false, at: '2026-09-11T00:00:00Z' as never }
}

/** A continued run's log, the thread it was handed then its own account. */
const CARRIED: readonly SkillEvent[] = [
  started('run-1', 'the question'),
  { type: 'message', text: 'the first answer' },
  started('run-2', 'You never called `showTrace`'),
  { type: 'message', text: 'the correction' },
]

describe('ownEvents', () => {
  it('drops the copy when the conversation already holds the run it came from', () => {
    const kept = ownEvents('run-2', CARRIED, new Set(['run-1', 'run-2']))

    expect(kept).toHaveLength(2)
    expect(kept[0]).toMatchObject({ type: 'started', runId: 'run-2' })
  })

  it('keeps the copy when the continuation is read on its own', () => {
    expect(ownEvents('run-2', CARRIED, new Set(['run-2']))).toHaveLength(4)
  })

  it('leaves a run that carried nothing untouched', () => {
    const events: SkillEvent[] = [started('run-1', 'the question'), { type: 'message', text: 'an answer' }]

    expect(ownEvents('run-1', events, new Set(['run-1']))).toBe(events)
  })

  it('leaves a log whose head was lost untouched', () => {
    const events: SkillEvent[] = [{ type: 'message', text: 'no start event above me' }]

    expect(ownEvents('run-2', events, new Set(['run-1', 'run-2']))).toBe(events)
  })
})
