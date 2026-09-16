import type { SkillEvent } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { withEvent } from '@/lib/runStore'

const delta = (text: string): SkillEvent => ({ type: 'message-delta', text })
const message = (text: string): SkillEvent => ({ type: 'message', text })

// The list is copied on every arrival and a long answer is thousands of fragments,
// so deltas may never accumulate as separate entries.
describe('withEvent', () => {
  it('folds a delta into the one before it rather than appending', () => {
    const events = [delta('he'), delta('l'), delta('lo')].reduce<readonly SkillEvent[]>(withEvent, [])
    expect(events).toEqual([delta('hello')])
  })

  it('leaves the list as it would have been once the whole message lands', () => {
    const streamed = [delta('he'), delta('llo'), message('hello')].reduce<readonly SkillEvent[]>(withEvent, [])
    const replayed = [message('hello')].reduce<readonly SkillEvent[]>(withEvent, [])
    expect(streamed).toEqual(replayed)
  })

  it('opens a fresh delta after a message closed the one before', () => {
    const events = [delta('first'), message('first'), delta('sec')].reduce<readonly SkillEvent[]>(withEvent, [])
    expect(events).toEqual([message('first'), delta('sec')])
  })

  it('appends anything that is not a delta', () => {
    const thinking: SkillEvent = { type: 'thinking', text: 'weighing it' }
    expect([delta('he'), thinking].reduce<readonly SkillEvent[]>(withEvent, [])).toEqual([delta('he'), thinking])
  })
})
