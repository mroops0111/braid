import { describe, expect, it } from 'vitest'
import { mapSubprocessEvents } from '../../../src/infrastructure/agent/subprocessEventStream.js'

const now = '2026-05-12T00:00:00+00:00'

describe('mapSubprocessEvents', () => {
  it('drops envelopes that carry no public-facing signal (system w/o session_id, rate_limit, user-success)', () => {
    expect(mapSubprocessEvents({ type: 'system', subtype: 'init' }, now)).toEqual([])
    expect(mapSubprocessEvents({ type: 'rate_limit_event' }, now)).toEqual([])
    expect(mapSubprocessEvents({
      type: 'user',
      message: { content: [{ type: 'tool_result', is_error: false, content: 'ok' }] },
    }, now)).toEqual([])
  })

  it('maps system/init with session_id into a session-started event', () => {
    const events = mapSubprocessEvents({
      type: 'system',
      subtype: 'init',
      session_id: 'abc-123-uuid',
    }, now)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'session-started', sessionId: 'abc-123-uuid' })
  })

  it('maps user.tool_result into a tool-result event with isError mirroring the stream flag', () => {
    const ok = mapSubprocessEvents({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: false, content: 'ok' }] },
    }, now)
    expect(ok[0]).toMatchObject({ type: 'tool-result', toolCallId: 't1', output: 'ok', isError: false })

    const bad = mapSubprocessEvents({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 't2', is_error: true, content: 'bash: cmd not found' }] },
    }, now)
    expect(bad[0]).toMatchObject({ type: 'tool-result', toolCallId: 't2', isError: true })
  })

  it('expands assistant.message.content[] into one event per text / tool_use part, preserving toolCallId', () => {
    const events = mapSubprocessEvents({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'hi' },
          { type: 'tool_use', id: 'toolu_abc', name: 'Bash', input: { command: 'ls' } },
        ],
      },
    }, now)

    expect(events.map(event => event.type)).toEqual(['message', 'tool-call'])
    expect(events[1]).toMatchObject({ type: 'tool-call', tool: 'Bash', toolCallId: 'toolu_abc' })
  })
})
