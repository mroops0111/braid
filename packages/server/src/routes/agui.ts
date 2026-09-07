import type { AgentMessage, RunRepository, SkillRunner, WorkspaceRepository } from '@braidhq/core'
import type { SkillEvent } from '@braidhq/schema'
import type { SSEStreamingApi } from 'hono/streaming'
import { RunAgentInputSchema } from '@ag-ui/core'
import { EventEncoder } from '@ag-ui/encoder'
import { ValidationError } from '@braidhq/core'
import { SkillId, SkillRunId } from '@braidhq/schema'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { AguiTranslator } from '../infrastructure/agui/AguiTranslator.js'
import { createAsyncQueue } from '../infrastructure/skill/asyncQueue.js'
import { extractBearerToken, getUserId } from '../middleware/auth.js'
import { getWorkspaceId } from '../middleware/workspaceId.js'
import { loadWorkspaceById } from './helpers.js'

export interface AguiRouterDeps {
  readonly skillRunner: SkillRunner
  readonly runRepository: RunRepository
  readonly workspaceRepository: WorkspaceRepository
}

/**
 * Only the roles an agent is given as conversation. A tool message is the
 * agent's own bookkeeping from a previous turn, and replaying it as if a person
 * wrote it would put words in their mouth.
 */
function toAgentMessages(input: { messages: readonly { role: string, content?: unknown }[] }): AgentMessage[] {
  return input.messages
    .filter(message => message.role === 'user' || message.role === 'assistant')
    .map(message => ({
      role: message.role === 'user' ? 'user' as const : 'assistant' as const,
      content: typeof message.content === 'string' ? message.content : '',
    }))
    .filter(message => message.content.length > 0)
}

/**
 * SSE only, deliberately. The encoder also speaks protobuf, but offering a
 * binary path with no consumer would ship an untested branch, and a client
 * asking for it is better told plainly than served a stream it did not request.
 */
function sseEncoder(): EventEncoder {
  return new EventEncoder({ accept: 'text/event-stream' })
}

async function writeAll(
  stream: SSEStreamingApi,
  encoder: EventEncoder,
  translator: AguiTranslator,
  event: SkillEvent,
): Promise<void> {
  for (const translated of translator.translate(event))
    await stream.write(encoder.encodeSSE(translated))
}

/**
 * Braid's runs, spoken as AG-UI.
 *
 * Outside the OpenAPI spec on purpose. This is somebody else's protocol rather
 * than part of Braid's REST surface, and every operation in the spec is
 * projected into MCP tools, where an endpoint that streams a whole run would
 * mean nothing to an agent.
 */
export function createAguiRouter(deps: AguiRouterDeps): Hono {
  const router = new Hono()

  // The protocol's own shape. A client POSTs the conversation and reads the
  // events, which is what asking a question already was.
  router.post('/', async (context) => {
    const workspace = await loadWorkspaceById(getWorkspaceId(context), deps.workspaceRepository)
    const parsed = RunAgentInputSchema.safeParse(await context.req.json())
    if (!parsed.success)
      throw new ValidationError(`Not a RunAgentInput: ${parsed.error.message}`)
    const input = parsed.data

    const forwarded = (input.forwardedProps ?? {}) as { skillId?: unknown, resumeSessionId?: unknown }
    if (typeof forwarded.skillId !== 'string')
      throw new ValidationError('`forwardedProps.skillId` must name the skill to run')
    const skillId = SkillId.parse(forwarded.skillId)

    const messages = toAgentMessages(input)
    const latest = messages.at(-1)
    if (!latest || latest.role !== 'user')
      throw new ValidationError('`messages` must end with the user message that starts this run')

    const callerToken = extractBearerToken(context)
    const runId = await deps.skillRunner.start(workspace, skillId, latest.content, {
      startedBy: getUserId(context),
      messages,
      ...(typeof forwarded.resumeSessionId === 'string' ? { resumeSessionId: forwarded.resumeSessionId } : {}),
      ...(callerToken ? { callerToken } : {}),
    })

    const encoder = sseEncoder()
    const translator = new AguiTranslator(input.threadId, runId)
    return streamSSE(context, async (stream) => {
      // The run is already draining by the time `start` returns, so anything
      // emitted before this subscription lands is only in the log. Backfilling
      // to the subscription point is what makes the stream whole rather than
      // whatever happened to arrive after the listener attached.
      const queue = createAsyncQueue<SkillEvent>()
      const { unsubscribe, positionAtSubscribe } = deps.skillRunner.subscribe(runId, event => queue.push(event))
      try {
        // Nothing emitted before the listener attached means no log to read,
        // and on a run this young the file may not exist to be opened at all.
        let delivered = 0
        if (positionAtSubscribe > 0) {
          for await (const event of deps.runRepository.readEvents(workspace, runId)) {
            if (delivered >= positionAtSubscribe)
              break
            await writeAll(stream, encoder, translator, event)
            delivered++
          }
        }
        for await (const event of queue.iterate()) {
          await writeAll(stream, encoder, translator, event)
          if (event.type === 'completed') {
            queue.end()
            break
          }
        }
      }
      finally {
        unsubscribe()
      }
    })
  })

  // Reading an answer again, and rejoining one still being written, are the
  // same act: replay what the log holds, then keep going if there is more. The
  // protocol has no endpoint for either, but the events are the protocol's, so
  // a client consumes this exactly as it consumes a live run.
  router.get('/runs/:runId', async (context) => {
    const workspace = await loadWorkspaceById(getWorkspaceId(context), deps.workspaceRepository)
    const runId = SkillRunId.parse(context.req.param('runId'))
    const threadId = context.req.query('threadId') ?? runId
    const encoder = sseEncoder()
    const translator = new AguiTranslator(threadId, runId)

    return streamSSE(context, async (stream) => {
      if (!deps.skillRunner.isActive(runId)) {
        for await (const event of deps.runRepository.readEvents(workspace, runId))
          await writeAll(stream, encoder, translator, event)
        return
      }

      // Subscribe before reading the log, so the position snapshot tells us
      // exactly how much of the log the live listener has not already covered.
      const queue = createAsyncQueue<SkillEvent>()
      const { unsubscribe, positionAtSubscribe } = deps.skillRunner.subscribe(runId, event => queue.push(event))
      try {
        let delivered = 0
        for await (const event of deps.runRepository.readEvents(workspace, runId)) {
          if (delivered >= positionAtSubscribe)
            break
          await writeAll(stream, encoder, translator, event)
          delivered++
        }
        for await (const event of queue.iterate()) {
          await writeAll(stream, encoder, translator, event)
          if (event.type === 'completed') {
            queue.end()
            break
          }
        }
      }
      finally {
        unsubscribe()
      }
    })
  })

  return router
}
