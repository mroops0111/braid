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

  it('maps result.is_error into an error event, with the run-failed fallback message', () => {
    expect(parse({ type: 'result', is_error: true, result: 'boom' })[0]).toMatchObject({ type: 'error', message: 'boom' })
    expect(parse({ type: 'result', is_error: true })[0]).toMatchObject({ type: 'error', message: 'skill run failed' })
  })

  it('maps a successful result with text into a message, and an empty result into nothing', () => {
    expect(parse({ type: 'result', is_error: false, result: 'done' })[0]).toMatchObject({ type: 'message', text: 'done' })
    expect(parse({ type: 'result', is_error: false, result: '' })).toEqual([])
  })

  it('maps the legacy flat text, tool_use, error, and artifact-written shapes', () => {
    expect(parse({ type: 'text', text: 'hi' })[0]).toMatchObject({ type: 'message', text: 'hi' })
    expect(parse({ type: 'tool_use', name: 'Bash', input: { command: 'ls' } })[0]).toMatchObject({ type: 'tool-call', tool: 'Bash' })
    expect(parse({ type: 'error', message: 'nope' })[0]).toMatchObject({ type: 'error', message: 'nope' })
    expect(parse({ type: 'artifact-written', artifactKind: 'view', artifactId: 'a1', path: '/abs/x.md' })[0])
      .toMatchObject({ type: 'artifact-written', artifactKind: 'view' })
  })

  it('returns [] for a known type whose required payload is absent', () => {
    expect(parse({ type: 'text' })).toEqual([])
    expect(parse({ type: 'tool_use' })).toEqual([])
    expect(parse({ type: 'result', is_error: false })).toEqual([])
  })

  it('surfaces an assistant thinking part, dropping an empty one', () => {
    const events = parse({
      type: 'assistant',
      message: { content: [{ type: 'thinking', thinking: 'let me reason', signature: 'sig' }] },
    })
    expect(events[0]).toMatchObject({ type: 'thinking', text: 'let me reason' })
    expect(parse({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: '' }] } })).toEqual([])
  })

  it('surfaces a rate_limit_event only when the status is not allowed', () => {
    expect(parse({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', resetsAt: 123 } })).toEqual([])
    const throttled = parse({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 456 } })
    expect(throttled[0]).toMatchObject({ type: 'rate-limit', status: 'rejected', resetsAt: 456 })
  })

  it('emits a usage event from the result envelope metrics, alongside the message', () => {
    const events = parse({
      type: 'result',
      is_error: false,
      result: 'done',
      total_cost_usd: 0.12,
      duration_ms: 5000,
      num_turns: 3,
      usage: { input_tokens: 100, output_tokens: 50 },
    })
    expect(events).toContainEqual(expect.objectContaining({ type: 'message', text: 'done' }))
    expect(events).toContainEqual(expect.objectContaining({
      type: 'usage',
      costUsd: 0.12,
      durationMs: 5000,
      turns: 3,
      inputTokens: 100,
      outputTokens: 50,
    }))
  })

  it('omits the usage event when the result carries no metrics', () => {
    expect(parse({ type: 'result', is_error: false, result: 'hi' }).some(event => event.type === 'usage')).toBe(false)
  })
})
