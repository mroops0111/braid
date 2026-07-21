import { describe, expect, it } from 'vitest'
import { parseClaudeLine } from '../src/claudeStream.js'

const now = '2024-01-01T00:00:00.000Z'

function parse(raw: unknown): ReturnType<typeof parseClaudeLine> {
  return parseClaudeLine(JSON.stringify(raw), now)
}

describe('parseClaudeLine', () => {
  it('returns [] for malformed or empty lines', () => {
    expect(parseClaudeLine('not json', now)).toEqual([])
    expect(parseClaudeLine('   ', now)).toEqual([])
  })

  it('drops envelopes that carry no public-facing signal (system w/o session_id, rate_limit, user-success)', () => {
    expect(parse({ type: 'system', subtype: 'init' })).toEqual([])
    expect(parse({ type: 'rate_limit_event' })).toEqual([])
    expect(parse({
      type: 'user',
      message: { content: [{ type: 'tool_result', is_error: false, content: 'ok' }] },
    })).toEqual([])
  })

  it('maps system/init with session_id into a session-started event', () => {
    const events = parse({ type: 'system', subtype: 'init', session_id: 'abc-123-uuid' })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'session-started', sessionId: 'abc-123-uuid' })
  })

  it('maps user.tool_result into a tool-result event with isError mirroring the stream flag', () => {
    const ok = parse({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: false, content: 'ok' }] },
    })
    expect(ok[0]).toMatchObject({ type: 'tool-result', toolCallId: 't1', output: 'ok', isError: false })

    const bad = parse({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 't2', is_error: true, content: 'bash: cmd not found' }] },
    })
    expect(bad[0]).toMatchObject({ type: 'tool-result', toolCallId: 't2', isError: true })
  })

  it('expands assistant.message.content[] into one event per text / tool_use part, preserving toolCallId', () => {
    const events = parse({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'hi' },
          { type: 'tool_use', id: 'toolu_abc', name: 'Bash', input: { command: 'ls' } },
        ],
      },
    })

    expect(events.map(event => event.type)).toEqual(['message', 'tool-call'])
    expect(events[1]).toMatchObject({ type: 'tool-call', tool: 'Bash', toolCallId: 'toolu_abc' })
  })
})
