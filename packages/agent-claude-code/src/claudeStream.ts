import type { SkillEvent } from '@braidhq/schema'
import { SkillEvent as SkillEventSchema } from '@braidhq/schema'

interface RawEvent { readonly type: string, readonly [key: string]: unknown }
interface RawContentPart { readonly type?: string, readonly [key: string]: unknown }

/**
 * Map one `claude --output-format stream-json` line into zero or more SkillEvents.
 * Claude emits these envelope shapes today.
 * `system` carries init meta, ignored except for `session_id`.
 * `assistant` carries text and tool_use content parts.
 * `user` echoes tool_result, only `is_error` surfaced.
 * `rate_limit_*` is ignored, and `result` is the final outcome.
 * Legacy flat shapes (`text`, `tool_use`, `artifact-written`, `error`)
 * are kept for tests and older tools.
 */
export function parseClaudeLine(line: string, now: string): SkillEvent[] {
  const trimmed = line.trim()
  if (trimmed.length === 0)
    return []
  let raw: RawEvent
  try {
    raw = JSON.parse(trimmed) as RawEvent
  }
  catch {
    return []
  }

  const out: SkillEvent[] = []

  if (raw.type === 'system' && raw.subtype === 'init' && typeof raw.session_id === 'string') {
    out.push(SkillEventSchema.parse({ type: 'session-started', sessionId: raw.session_id }))
    return out
  }

  if (raw.type === 'assistant') {
    for (const part of readContent(raw)) {
      if (part?.type === 'text' && typeof part.text === 'string' && part.text.length > 0) {
        out.push(SkillEventSchema.parse({ type: 'message', text: part.text }))
      }
      else if (part?.type === 'tool_use' && typeof part.name === 'string') {
        const event: Record<string, unknown> = {
          type: 'tool-call',
          tool: part.name,
          args: part.input ?? null,
        }
        if (typeof part.id === 'string' && part.id.length > 0)
          event.toolCallId = part.id
        out.push(SkillEventSchema.parse(event))
      }
    }
    return out
  }

  if (raw.type === 'user') {
    for (const part of readContent(raw)) {
      if (part?.type === 'tool_result' && typeof part.tool_use_id === 'string') {
        const output = typeof part.content === 'string'
          ? part.content
          : JSON.stringify(part.content ?? '')
        out.push(SkillEventSchema.parse({
          type: 'tool-result',
          toolCallId: part.tool_use_id,
          output,
          isError: part.is_error === true,
        }))
      }
    }
    return out
  }

  if (raw.type === 'result') {
    const isError = raw.is_error === true
    const text = typeof raw.result === 'string' ? raw.result : ''
    if (isError)
      out.push(SkillEventSchema.parse({ type: 'error', message: text || 'skill run failed', at: now }))
    else if (text.length > 0)
      out.push(SkillEventSchema.parse({ type: 'message', text }))
    return out
  }

  if (raw.type === 'text' && typeof raw.text === 'string')
    return [SkillEventSchema.parse({ type: 'message', text: raw.text })]

  if (raw.type === 'tool_use' && typeof raw.name === 'string')
    return [SkillEventSchema.parse({ type: 'tool-call', tool: raw.name, args: raw.input ?? null })]

  if (raw.type === 'artifact-written' && typeof raw.artifactKind === 'string') {
    return [SkillEventSchema.parse({
      type: 'artifact-written',
      artifactKind: raw.artifactKind,
      artifactId: raw.artifactId,
      path: raw.path,
    })]
  }

  if (raw.type === 'error' && typeof raw.message === 'string')
    return [SkillEventSchema.parse({ type: 'error', message: raw.message, at: now })]

  return out
}

function readContent(raw: RawEvent): RawContentPart[] {
  const message = raw.message as { content?: unknown } | undefined
  if (!message || !Array.isArray(message.content))
    return []
  return message.content as RawContentPart[]
}
