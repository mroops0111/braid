import type { SkillEvent, SkillRunId } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { groupTranscript } from '@/components/SkillTranscript/groupTranscript'

const now = '2026-05-13T00:00:00+00:00'

function call(id: string, tool = 'Bash'): SkillEvent {
  return { type: 'tool-call', tool, args: { command: 'ls' }, toolCallId: id }
}
function result(id: string, isError = false, output = 'ok'): SkillEvent {
  return { type: 'tool-result', toolCallId: id, output, isError }
}
function message(text: string): SkillEvent {
  return { type: 'message', text }
}
function started(): SkillEvent {
  return { type: 'started', runId: 'sr-1' as SkillRunId, skillId: 'braid-ask' as never, at: now }
}

describe('groupTranscript', () => {
  it('passes through non-tool events as their own items', () => {
    const items = groupTranscript([started(), message('hi')])
    expect(items.map(i => i.kind)).toEqual(['event', 'event'])
  })

  it('merges consecutive tool-call + tool-result into one group', () => {
    const items = groupTranscript([
      call('a'),
      result('a'),
      call('b'),
      result('b'),
    ])
    expect(items).toHaveLength(1)
    const group = items[0]!
    if (group.kind !== 'tool-group')
      throw new Error('expected tool-group')
    expect(group.calls).toHaveLength(2)
    expect(group.calls[0]?.call.toolCallId).toBe('a')
    expect(group.calls[0]?.result?.toolCallId).toBe('a')
    expect(group.calls[1]?.result?.isError).toBe(false)
  })

  it('breaks the group when a non-tool event interrupts', () => {
    const items = groupTranscript([
      call('a'),
      result('a'),
      message('intermediate thought'),
      call('b'),
      result('b'),
    ])
    expect(items.map(i => i.kind)).toEqual(['tool-group', 'event', 'tool-group'])
  })

  it('pairs by toolCallId even when results arrive out of order', () => {
    const items = groupTranscript([
      call('a'),
      call('b'),
      result('b'),
      result('a'),
    ])
    expect(items).toHaveLength(1)
    const group = items[0]!
    if (group.kind !== 'tool-group')
      throw new Error('expected tool-group')
    expect(group.calls[0]?.result?.toolCallId).toBe('a')
    expect(group.calls[1]?.result?.toolCallId).toBe('b')
  })

  it('attaches an orphan tool-result to a synthetic "(unknown tool)" row', () => {
    const items = groupTranscript([result('ghost', true, 'oops')])
    expect(items).toHaveLength(1)
    const group = items[0]!
    if (group.kind !== 'tool-group')
      throw new Error('expected tool-group')
    expect(group.calls).toHaveLength(1)
    expect(group.calls[0]?.call.tool).toBe('(unknown tool)')
    expect(group.calls[0]?.result?.isError).toBe(true)
  })

  it('starts a new group when a tool-result follows a message', () => {
    const items = groupTranscript([
      message('about to run'),
      call('a'),
      result('a'),
    ])
    expect(items.map(i => i.kind)).toEqual(['event', 'tool-group'])
  })

  it('produces stable keys', () => {
    const items = groupTranscript([started(), call('a'), result('a')])
    const keys = items.map(i => i.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('preserves call order within a group', () => {
    const items = groupTranscript([
      call('a', 'Bash'),
      call('b', 'Read'),
      call('c', 'Bash'),
      result('a'),
      result('b'),
      result('c'),
    ])
    const group = items[0]!
    if (group.kind !== 'tool-group')
      throw new Error('expected tool-group')
    expect(group.calls.map(c => c.call.tool)).toEqual(['Bash', 'Read', 'Bash'])
  })
})
