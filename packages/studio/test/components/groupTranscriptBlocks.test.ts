import type { SkillEvent } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { groupTranscript } from '@/components/SkillTranscript/groupTranscript'

// A render call produces a block, and the block arrives out of band, landing
// between the call and its result. Grouping only within a run of adjacent tool
// events would leave the result alone, reading as a tool nobody called.
describe('groupTranscript with a block between a call and its result', () => {
  const events: SkillEvent[] = [
    { type: 'tool-call', tool: 'mcp__braid-core__show_answer', args: null, toolCallId: 'c1' },
    { type: 'block', id: 'b1' as never, block: { call: 'showAnswer', audiences: [], markdown: 'hello' } as never },
    { type: 'tool-result', toolCallId: 'c1', output: '{"ok":true}', isError: false },
  ]

  it('joins the result to the call it belongs to', () => {
    const items = groupTranscript(events)
    const groups = items.filter(item => item.kind === 'tool-group')
    expect(groups).toHaveLength(1)
    expect(groups[0]!.calls).toHaveLength(1)
    expect(groups[0]!.calls[0]!.call.tool).toBe('mcp__braid-core__show_answer')
    expect(groups[0]!.calls[0]!.result?.output).toBe('{"ok":true}')
  })

  it('leaves no group for a result that found its call further up', () => {
    expect(groupTranscript(events).map(item => item.kind)).toEqual(['tool-group', 'event'])
  })

  it('still shows a result whose call was never seen', () => {
    const orphan = groupTranscript([{ type: 'tool-result', toolCallId: 'nope', output: 'x', isError: false }])
    expect(orphan).toHaveLength(1)
    expect(orphan[0]!.kind).toBe('tool-group')
  })
})
