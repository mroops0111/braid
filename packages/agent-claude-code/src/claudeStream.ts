import type { SkillEvent } from '@braidhq/schema'
import { SkillEvent as SkillEventSchema } from '@braidhq/schema'

interface RawEvent { readonly type: string, readonly [key: string]: unknown }
interface RawContentPart { readonly type?: string, readonly [key: string]: unknown }

/**
 * Map one `claude --output-format stream-json` line into zero or more
 * SkillEvents. Claude emits these envelope shapes:
 *   - `system` subtype `init`: session metadata, only `session_id` is kept.
 *   - `assistant`: content parts, `text`, `tool_use`, and `thinking` surface.
 *   - `user`: echoes a `tool_result`, only its `is_error` flag surfaces.
 *   - `result`: the outcome, `is_error` picks a message or error, plus usage.
 *   - `rate_limit_event`: surfaced only when the run is actually throttled.
 *
 * Legacy flat shapes are kept for tests and older tools,
 * `text`, `tool_use`, `artifact-written`, and `error`.
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

  if (raw.type === 'rate_limit_event') {
    const info = raw.rate_limit_info as { status?: unknown, resetsAt?: unknown } | undefined
    // Emitted on every run, so only surface it when a limit actually bites.
    if (info && typeof info.status === 'string' && info.status !== 'allowed') {
      out.push(SkillEventSchema.parse({
        type: 'rate-limit',
        status: info.status,
        ...(typeof info.resetsAt === 'number' ? { resetsAt: info.resetsAt } : {}),
      }))
    }
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
      else if (part?.type === 'thinking' && typeof part.thinking === 'string' && part.thinking.length > 0) {
        out.push(SkillEventSchema.parse({ type: 'thinking', text: part.thinking }))
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
    const usage = raw.usage as { input_tokens?: unknown, output_tokens?: unknown } | undefined
    const usageEvent: Record<string, unknown> = { type: 'usage' }
    if (typeof raw.total_cost_usd === 'number')
      usageEvent.costUsd = raw.total_cost_usd
    if (typeof raw.duration_ms === 'number')
      usageEvent.durationMs = raw.duration_ms
    if (typeof raw.num_turns === 'number')
      usageEvent.turns = raw.num_turns
    if (usage && typeof usage.input_tokens === 'number')
      usageEvent.inputTokens = usage.input_tokens
    if (usage && typeof usage.output_tokens === 'number')
      usageEvent.outputTokens = usage.output_tokens
    // Only emit when the envelope actually carried a metric.
    if (Object.keys(usageEvent).length > 1)
      out.push(SkillEventSchema.parse(usageEvent))
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
