import type { BaseEvent } from '@ag-ui/core'
import type { SkillEvent } from '@braidhq/schema'
import { EventType } from '@ag-ui/core'

/** Braid-specific events ride on CUSTOM, namespaced so a consumer can ignore them. */
const CUSTOM_NAMES = {
  session: 'braid.session',
  block: 'braid.block',
  artifact: 'braid.artifact',
  rateLimit: 'braid.rateLimit',
  usage: 'braid.usage',
  error: 'braid.error',
} as const

/**
 * Braid's own run events, spoken as AG-UI.
 *
 * The translation is one way and happens only here, at the HTTP boundary.
 * Nothing upstream knows AG-UI exists, which is why an agent plugin needs no
 * change to be reachable by an AG-UI client. It parses its agent's output into
 * `SkillEvent` as it always did.
 *
 * Stateful because AG-UI addresses a message by id across three events, while
 * an agent hands Braid whole messages. The counter is what turns one into the
 * other, so a translator belongs to one run and is not shared.
 */
export class AguiTranslator {
  private messageCount = 0
  private toolCallCount = 0

  private opened = false

  constructor(
    private readonly threadId: string,
    private readonly runId: string,
  ) {}

  translate(event: SkillEvent): BaseEvent[] {
    switch (event.type) {
      // One run, one opening frame. A run that carries another on opens
      // holding that run's account, so a second start arrives inside the same
      // stream, and the protocol refuses a second `RUN_STARTED` while a run is
      // still active. The later ones are the carried thread describing itself,
      // which the log keeps and the wire does not need.
      case 'started': {
        if (this.opened)
          return []
        this.opened = true
        return [{ type: EventType.RUN_STARTED, threadId: this.threadId, runId: this.runId }]
      }

      // A message arrives whole, so the triplet is emitted at once rather than
      // streamed. A consumer sees a complete message either way, and the shape
      // stays the one every AG-UI client already handles.
      case 'message': {
        const messageId = this.nextMessageId()
        return [
          { type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant' },
          { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: event.text },
          { type: EventType.TEXT_MESSAGE_END, messageId },
        ]
      }

      case 'thinking': {
        const messageId = this.nextMessageId()
        return [
          { type: EventType.REASONING_MESSAGE_START, messageId, role: 'reasoning' },
          { type: EventType.REASONING_MESSAGE_CONTENT, messageId, delta: event.text },
          { type: EventType.REASONING_MESSAGE_END, messageId },
        ]
      }

      case 'tool-call': {
        const toolCallId = event.toolCallId ?? this.nextToolCallId()
        return [
          { type: EventType.TOOL_CALL_START, toolCallId, toolCallName: event.tool },
          { type: EventType.TOOL_CALL_ARGS, toolCallId, delta: JSON.stringify(event.args ?? {}) },
          { type: EventType.TOOL_CALL_END, toolCallId },
        ]
      }

      case 'tool-result':
        return [{
          type: EventType.TOOL_CALL_RESULT,
          messageId: this.nextMessageId(),
          toolCallId: event.toolCallId,
          content: event.output,
        }]

      // The block union is Braid's vocabulary, so it rides on CUSTOM rather
      // than being bent into an AG-UI type that means something else. A client
      // that does not know the vocabulary skips one named event.
      case 'block':
        return [{ type: EventType.CUSTOM, name: CUSTOM_NAMES.block, value: { id: event.id, block: event.block } }]

      case 'session-started':
        return [{ type: EventType.CUSTOM, name: CUSTOM_NAMES.session, value: { sessionId: event.sessionId } }]

      case 'artifact-written':
        return [{
          type: EventType.CUSTOM,
          name: CUSTOM_NAMES.artifact,
          value: { kind: event.artifactKind, id: event.artifactId },
        }]

      case 'rate-limit':
        return [{ type: EventType.CUSTOM, name: CUSTOM_NAMES.rateLimit, value: { status: event.status } }]

      case 'usage':
        return [{ type: EventType.CUSTOM, name: CUSTOM_NAMES.usage, value: { ...event, type: undefined } }]

      // Not RUN_ERROR. A Braid run reports an error and keeps going, while
      // RUN_ERROR ends the stream for a conformant client. What the run
      // finished as is decided below, by the exit code.
      case 'error':
        return [{ type: EventType.CUSTOM, name: CUSTOM_NAMES.error, value: { message: event.message } }]

      case 'completed':
        return event.exitCode === 0
          ? [{ type: EventType.RUN_FINISHED, threadId: this.threadId, runId: this.runId }]
          : [{ type: EventType.RUN_ERROR, message: `Run exited with code ${event.exitCode}`, code: String(event.exitCode) }]

      default: {
        const exhaustive: never = event
        throw new Error(`Unhandled: ${JSON.stringify(exhaustive)}`)
      }
    }
  }

  private nextMessageId(): string {
    this.messageCount += 1
    return `${this.runId}-msg-${this.messageCount}`
  }

  private nextToolCallId(): string {
    this.toolCallCount += 1
    return `${this.runId}-tool-${this.toolCallCount}`
  }
}
