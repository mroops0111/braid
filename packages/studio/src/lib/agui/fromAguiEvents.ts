import type { BaseEvent } from '@ag-ui/client'
import type { EmittedBlock, SkillEvent } from '@braidhq/schema'
import { EventType } from '@ag-ui/client'

/**
 * AG-UI events, read back as Braid's own.
 *
 * The wire format is the protocol's, the shape this app reasons about is
 * Braid's, and this is the one place the two meet. A message spans three
 * events on the wire and is one thing here, so a translator is stateful and
 * belongs to a single run.
 *
 * No view-framework imports on purpose. A second consumer of the same stream
 * should be able to take this file as it stands.
 */
export class AguiEventReader {
  private readonly openText = new Map<string, string>()
  private readonly openReasoning = new Map<string, string>()
  private readonly openToolCalls = new Map<string, { tool: string, args: string }>()

  /**
   * Zero or more Braid events. Zero is the common case mid-message, since
   * nothing is complete until the end event that closes it arrives.
   */
  read(event: BaseEvent): SkillEvent[] {
    const raw = event as Record<string, unknown>
    switch (event.type) {
      case EventType.TEXT_MESSAGE_START:
        this.openText.set(String(raw.messageId), '')
        return []
      case EventType.TEXT_MESSAGE_CONTENT:
        return this.appendTo(this.openText, raw)
      case EventType.TEXT_MESSAGE_END: {
        const text = this.openText.get(String(raw.messageId))
        this.openText.delete(String(raw.messageId))
        return text === undefined ? [] : [{ type: 'message', text }]
      }

      case EventType.REASONING_MESSAGE_START:
        this.openReasoning.set(String(raw.messageId), '')
        return []
      case EventType.REASONING_MESSAGE_CONTENT:
        return this.appendTo(this.openReasoning, raw)
      case EventType.REASONING_MESSAGE_END: {
        const text = this.openReasoning.get(String(raw.messageId))
        this.openReasoning.delete(String(raw.messageId))
        return text === undefined ? [] : [{ type: 'thinking', text }]
      }

      case EventType.TOOL_CALL_START:
        this.openToolCalls.set(String(raw.toolCallId), { tool: String(raw.toolCallName), args: '' })
        return []
      case EventType.TOOL_CALL_ARGS: {
        const open = this.openToolCalls.get(String(raw.toolCallId))
        if (open)
          open.args += String(raw.delta ?? '')
        return []
      }
      case EventType.TOOL_CALL_END: {
        const toolCallId = String(raw.toolCallId)
        const open = this.openToolCalls.get(toolCallId)
        this.openToolCalls.delete(toolCallId)
        if (!open)
          return []
        return [{ type: 'tool-call', tool: open.tool, args: parseArgs(open.args), toolCallId }]
      }
      case EventType.TOOL_CALL_RESULT:
        return [{
          type: 'tool-result',
          toolCallId: String(raw.toolCallId),
          output: String(raw.content ?? ''),
          isError: false,
        }]

      case EventType.CUSTOM:
        return this.readCustom(raw)

      // The run's own boundaries are the transport's business. What the UI
      // needs from them travels as `braid.usage` and the block sequence, and a
      // reader that treated RUN_FINISHED as an event would double-count it
      // against the transcript the log already holds.
      case EventType.RUN_STARTED:
      case EventType.RUN_FINISHED:
        return []
      case EventType.RUN_ERROR:
        return [{ type: 'error', message: String(raw.message ?? 'Run failed'), at: new Date().toISOString() }]

      default:
        return []
    }
  }

  private appendTo(open: Map<string, string>, raw: Record<string, unknown>): SkillEvent[] {
    const id = String(raw.messageId)
    const current = open.get(id)
    if (current !== undefined)
      open.set(id, current + String(raw.delta ?? ''))
    return []
  }

  private readCustom(raw: Record<string, unknown>): SkillEvent[] {
    const value = (raw.value ?? {}) as Record<string, unknown>
    switch (raw.name) {
      case 'braid.block': {
        const emitted = value as unknown as EmittedBlock
        return [{ type: 'block', id: emitted.id, block: emitted.block }]
      }
      case 'braid.session':
        return [{ type: 'session-started', sessionId: String(value.sessionId) }]
      case 'braid.usage':
        return [{ type: 'usage', ...value } as SkillEvent]
      case 'braid.rateLimit':
        return [{ type: 'rate-limit', status: String(value.status) }]
      case 'braid.error':
        return [{ type: 'error', message: String(value.message), at: new Date().toISOString() }]
      default:
        return []
    }
  }
}

/** A tool call whose args never parsed is still worth showing, without them. */
function parseArgs(args: string): unknown {
  try {
    return JSON.parse(args) as unknown
  }
  catch {
    return args
  }
}
