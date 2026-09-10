import type { BaseEvent } from '@ag-ui/client'
import type { RenderBlock } from '@braidhq/schema'
import { EventType } from '@ag-ui/client'
import { describe, expect, it } from 'vitest'
import { AguiEventReader } from '@/lib/agui/fromAguiEvents'

function frame(fields: Record<string, unknown>): BaseEvent {
  return fields as unknown as BaseEvent
}

function readAll(frames: readonly Record<string, unknown>[]) {
  const reader = new AguiEventReader()
  return frames.flatMap(fields => reader.read(frame(fields)))
}

// A message spans three frames on the wire and is one thing here, so nothing
// may be reported until the frame that closes it arrives.
describe('AguiEventReader on a text message', () => {
  it('reports one message once its end arrives, not before', () => {
    const reader = new AguiEventReader()
    expect(reader.read(frame({ type: EventType.TEXT_MESSAGE_START, messageId: 'm1', role: 'assistant' }))).toEqual([])
    expect(reader.read(frame({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm1', delta: 'he' }))).toEqual([])
    expect(reader.read(frame({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm1', delta: 'llo' }))).toEqual([])
    expect(reader.read(frame({ type: EventType.TEXT_MESSAGE_END, messageId: 'm1' })))
      .toEqual([{ type: 'message', text: 'hello' }])
  })

  // The prompt travels as the user message that opens the turn, and once both
  // are text on a wire the role is the only thing telling them apart.
  it('keeps who said it when the message is the reader own prompt', () => {
    const events = readAll([
      { type: EventType.TEXT_MESSAGE_START, messageId: 'm1', role: 'user' },
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm1', delta: 'what changed' },
      { type: EventType.TEXT_MESSAGE_END, messageId: 'm1' },
    ])
    expect(events).toEqual([{ type: 'message', text: 'what changed', role: 'user' }])
  })

  it('keeps two messages apart while both are open', () => {
    const events = readAll([
      { type: EventType.TEXT_MESSAGE_START, messageId: 'm1', role: 'user' },
      { type: EventType.TEXT_MESSAGE_START, messageId: 'm2', role: 'assistant' },
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm2', delta: 'second' },
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm1', delta: 'first' },
      { type: EventType.TEXT_MESSAGE_END, messageId: 'm1' },
      { type: EventType.TEXT_MESSAGE_END, messageId: 'm2' },
    ])
    expect(events).toEqual([
      { type: 'message', text: 'first', role: 'user' },
      { type: 'message', text: 'second' },
    ])
  })

  // A replay joined midway holds ends for starts it never saw.
  it('reports nothing for an end whose start it never saw', () => {
    expect(readAll([{ type: EventType.TEXT_MESSAGE_END, messageId: 'never-opened' }])).toEqual([])
  })

  // Roles do not leak between messages: the set is cleared as each closes.
  it('does not carry a user role into the next message on the same id', () => {
    const events = readAll([
      { type: EventType.TEXT_MESSAGE_START, messageId: 'm1', role: 'user' },
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm1', delta: 'asked' },
      { type: EventType.TEXT_MESSAGE_END, messageId: 'm1' },
      { type: EventType.TEXT_MESSAGE_START, messageId: 'm1', role: 'assistant' },
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm1', delta: 'answered' },
      { type: EventType.TEXT_MESSAGE_END, messageId: 'm1' },
    ])
    expect(events).toEqual([
      { type: 'message', text: 'asked', role: 'user' },
      { type: 'message', text: 'answered' },
    ])
  })
})

describe('AguiEventReader on reasoning', () => {
  it('reports thinking once its end arrives', () => {
    const events = readAll([
      { type: EventType.REASONING_MESSAGE_START, messageId: 'r1' },
      { type: EventType.REASONING_MESSAGE_CONTENT, messageId: 'r1', delta: 'weighing it' },
      { type: EventType.REASONING_MESSAGE_END, messageId: 'r1' },
    ])
    expect(events).toEqual([{ type: 'thinking', text: 'weighing it' }])
  })
})

describe('AguiEventReader on a tool call', () => {
  it('assembles the streamed args into one call', () => {
    const events = readAll([
      { type: EventType.TOOL_CALL_START, toolCallId: 't1', toolCallName: 'Bash' },
      { type: EventType.TOOL_CALL_ARGS, toolCallId: 't1', delta: '{"command"' },
      { type: EventType.TOOL_CALL_ARGS, toolCallId: 't1', delta: ':"ls"}' },
      { type: EventType.TOOL_CALL_END, toolCallId: 't1' },
    ])
    expect(events).toEqual([
      { type: 'tool-call', tool: 'Bash', args: { command: 'ls' }, toolCallId: 't1' },
    ])
  })

  // A call whose args never parsed is still worth showing, without them.
  it('keeps args that are not json as the text they arrived as', () => {
    const events = readAll([
      { type: EventType.TOOL_CALL_START, toolCallId: 't1', toolCallName: 'Bash' },
      { type: EventType.TOOL_CALL_ARGS, toolCallId: 't1', delta: 'not json' },
      { type: EventType.TOOL_CALL_END, toolCallId: 't1' },
    ])
    expect(events[0]).toMatchObject({ args: 'not json' })
  })

  it('reports a result on its own, since nothing has to be open for one', () => {
    const events = readAll([
      { type: EventType.TOOL_CALL_RESULT, toolCallId: 't1', content: 'done' },
    ])
    expect(events).toEqual([{ type: 'tool-result', toolCallId: 't1', output: 'done', isError: false }])
  })

  it('reports nothing for an end whose start it never saw', () => {
    expect(readAll([{ type: EventType.TOOL_CALL_END, toolCallId: 'never-opened' }])).toEqual([])
  })
})

describe('AguiEventReader on braid custom events', () => {
  const block: RenderBlock = { call: 'showAnswer', audiences: [], markdown: 'hello' }

  it('reads a block back whole', () => {
    const events = readAll([
      { type: EventType.CUSTOM, name: 'braid.block', value: { id: 'block-1', block } },
    ])
    expect(events).toEqual([{ type: 'block', id: 'block-1', block }])
  })

  it('reads the session, usage and rate limit each as their own event', () => {
    const events = readAll([
      { type: EventType.CUSTOM, name: 'braid.session', value: { sessionId: 's-1' } },
      { type: EventType.CUSTOM, name: 'braid.usage', value: { costUsd: 0.5 } },
      { type: EventType.CUSTOM, name: 'braid.rateLimit', value: { status: 'rejected' } },
    ])
    expect(events).toEqual([
      { type: 'session-started', sessionId: 's-1' },
      { type: 'usage', costUsd: 0.5 },
      { type: 'rate-limit', status: 'rejected' },
    ])
  })

  it('ignores a custom event it does not know', () => {
    expect(readAll([{ type: EventType.CUSTOM, name: 'something.else', value: {} }])).toEqual([])
  })
})

describe('AguiEventReader on the run boundaries', () => {
  // What the surface needs from them travels as its own event, and a reader
  // that reported these would double-count them against the log.
  it('reports nothing for the frames that open and close the run', () => {
    expect(readAll([
      { type: EventType.RUN_STARTED, threadId: 'th', runId: 'r' },
      { type: EventType.RUN_FINISHED, threadId: 'th', runId: 'r' },
    ])).toEqual([])
  })

  it('reports a run error as an error', () => {
    const events = readAll([{ type: EventType.RUN_ERROR, message: 'exited 1' }])
    expect(events[0]).toMatchObject({ type: 'error', message: 'exited 1' })
  })

  // A mid-run error keeps its own wording rather than the run's.
  it('reports a mid-run error as an error too', () => {
    const events = readAll([{ type: EventType.CUSTOM, name: 'braid.error', value: { message: 'boom' } }])
    expect(events[0]).toMatchObject({ type: 'error', message: 'boom' })
  })
})
