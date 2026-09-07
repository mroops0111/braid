import type { SkillEvent } from '@braidhq/schema'
import { EventSchemas, EventType } from '@ag-ui/core'
import { BlockId, SkillId, SkillRunId } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { AguiTranslator } from '../../../src/infrastructure/agui/AguiTranslator.js'

const RUN_ID = SkillRunId.parse('skill-run-1')
const AT = '2026-09-07T00:00:00.000Z'

function translator(): AguiTranslator {
  return new AguiTranslator('thread-1', RUN_ID)
}

const started: SkillEvent = {
  type: 'started',
  runId: RUN_ID,
  skillId: SkillId.parse('ask'),
  args: 'a question',
  resumed: false,
  at: AT,
}

describe('aguiTranslator', () => {
  it('opens the stream with a run started carrying both ids', () => {
    expect(translator().translate(started)).toEqual([
      { type: EventType.RUN_STARTED, threadId: 'thread-1', runId: 'skill-run-1' },
    ])
  })

  it('spells a whole message as the three events that address one id', () => {
    const events = translator().translate({ type: 'message', text: 'hello' })
    expect(events.map(event => event.type)).toEqual([
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
    ])
    const ids = new Set(events.map(event => (event as { messageId: string }).messageId))
    expect(ids.size).toBe(1)
  })

  it('gives each message its own id', () => {
    const subject = translator()
    const first = subject.translate({ type: 'message', text: 'one' })[0] as { messageId: string }
    const second = subject.translate({ type: 'message', text: 'two' })[0] as { messageId: string }
    expect(first.messageId).not.toBe(second.messageId)
  })

  it('carries a tool call as start, args, end under one call id', () => {
    const events = translator().translate({ type: 'tool-call', tool: 'show_answer', args: { title: 'x' }, toolCallId: 'call-1' })
    expect(events.map(event => event.type)).toEqual([
      EventType.TOOL_CALL_START,
      EventType.TOOL_CALL_ARGS,
      EventType.TOOL_CALL_END,
    ])
    expect(events.every(event => (event as { toolCallId: string }).toolCallId === 'call-1')).toBe(true)
    expect((events[1] as { delta: string }).delta).toBe('{"title":"x"}')
  })

  it('invents a call id when the agent stream carried none', () => {
    const events = translator().translate({ type: 'tool-call', tool: 'grep', args: {} })
    expect((events[0] as { toolCallId: string }).toolCallId).toBe('skill-run-1-tool-1')
  })

  it('carries a block as a namespaced custom event', () => {
    const block = { call: 'showTrace', audiences: [], searches: [], hits: 0, read: 0, cited: 0 } as never
    const events = translator().translate({ type: 'block', id: BlockId.parse('block-1'), block })
    expect(events).toEqual([
      { type: EventType.CUSTOM, name: 'braid.block', value: { id: 'block-1', block } },
    ])
  })

  it('reports a mid-run error without ending the stream', () => {
    const events = translator().translate({ type: 'error', message: 'boom', at: AT })
    expect(events[0]!.type).toBe(EventType.CUSTOM)
    expect(events[0]!.type).not.toBe(EventType.RUN_ERROR)
  })

  it('closes a clean exit with run finished', () => {
    const events = translator().translate({ type: 'completed', runId: RUN_ID, exitCode: 0, at: AT })
    expect(events[0]!.type).toBe(EventType.RUN_FINISHED)
  })

  it('closes a failed exit with run error', () => {
    const events = translator().translate({ type: 'completed', runId: RUN_ID, exitCode: 2, at: AT })
    expect(events[0]!.type).toBe(EventType.RUN_ERROR)
  })

  // The point of adopting the protocol rather than copying its shape. If our
  // events do not satisfy the published schemas, we have not implemented it.
  it('emits events the protocol itself accepts', () => {
    const subject = translator()
    const inputs: SkillEvent[] = [
      started,
      { type: 'session-started', sessionId: 'sess-1' },
      { type: 'message', text: 'hello' },
      { type: 'thinking', text: 'considering' },
      { type: 'tool-call', tool: 'grep', args: { pattern: 'x' } },
      { type: 'tool-result', toolCallId: 'call-1', output: 'ok', isError: false },
      { type: 'rate-limit', status: 'throttled' },
      { type: 'usage', costUsd: 1.5, turns: 3 },
      { type: 'error', message: 'boom', at: AT },
      { type: 'completed', runId: RUN_ID, exitCode: 0, at: AT },
    ]
    for (const input of inputs) {
      for (const event of subject.translate(input))
        expect(() => EventSchemas.parse(event)).not.toThrow()
    }
  })
})
