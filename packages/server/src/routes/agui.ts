import type { AgentMessage, Clarification, ClarificationRepository, RunRepository, SkillRunner, Workspace, WorkspaceRepository } from '@braidhq/core'
import type { SkillEvent, SkillRunId as SkillRunIdType, WorkspaceId } from '@braidhq/schema'
import type { SSEStreamingApi } from 'hono/streaming'
import { EventType, RunAgentInputSchema } from '@ag-ui/core'
import { EventEncoder } from '@ag-ui/encoder'
import { describeContinuation, NotFoundError, outcomeOf, runScope, ValidationError } from '@braidhq/core'
import { ClarificationId, SkillId, SkillRunId } from '@braidhq/schema'
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
  readonly clarificationRepository: ClarificationRepository
}

/**
 * Only the roles an agent is given as conversation.
 * A tool message is the agent's own bookkeeping from a previous turn,
 * and replaying it as if a person wrote it would put words in their mouth.
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
 * SSE only, deliberately.
 * The encoder also speaks protobuf,
 * but a binary path with no consumer would ship an untested branch,
 * and a client asking for it is better told plainly,
 * than served a stream it did not request.
 */
function sseEncoder(): EventEncoder {
  return new EventEncoder({ accept: 'text/event-stream' })
}

/**
 * The questions this run left open, spoken as the protocol's own interrupts.
 *
 * A run that could not decide something raised a Clarification and stopped.
 * Ending such a run with a plain `RUN_FINISHED` would say the work is over,
 * when it is only waiting,
 * so the outcome names what it waits on and a client resumes by answering.
 */
async function openInterrupts(
  deps: AguiRouterDeps,
  workspaceId: WorkspaceId,
  runId: SkillRunIdType,
): Promise<{ id: string, reason: string, message: string }[]> {
  const pending = await deps.clarificationRepository.list({ workspaceId, statuses: ['pending'] })
  return pending
    .filter(clarification => clarification.skillRunId === runId)
    .map(clarification => ({
      id: clarification.id,
      reason: 'clarification',
      message: clarification.question,
    }))
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
 * A resumed turn, built from the answer rather than from what the client says.
 *
 * The client names the interrupt it resolved.
 * Everything else, which run to continue and which conversation it holds,
 * is looked up here, so a caller cannot resume a run it did not answer for.
 */
async function resolveResume(
  deps: AguiRouterDeps,
  workspace: Workspace,
  entries: readonly { interruptId: string, status?: string }[],
): Promise<{ skillId: SkillId, resumeSessionId: string, message: string, scope: string, continues: SkillRunIdType } | null> {
  const resolved = entries.filter(entry => entry.status !== 'cancelled')
  if (resolved.length === 0)
    return null

  const settled: Clarification[] = []
  let runId: SkillRunIdType | undefined
  for (const entry of resolved) {
    const clarification = await deps.clarificationRepository.load(ClarificationId.parse(entry.interruptId))
    if (clarification.workspaceId !== workspace.id)
      throw new NotFoundError(`Clarification "${entry.interruptId}" not found`)
    // Answered, deferred, and set aside are three ways of settling a question,
    // and every one of them releases the run.
    // What is refused is a question still open,
    // because that run is still rightly waiting.
    if (!outcomeOf(clarification))
      throw new ValidationError(`Clarification "${entry.interruptId}" is still open, so there is nothing to resume with`)
    if (!clarification.skillRunId)
      throw new ValidationError(`Clarification "${entry.interruptId}" was not raised by a run, so it has no conversation to continue`)
    runId ??= clarification.skillRunId
    if (clarification.skillRunId !== runId)
      throw new ValidationError('Every answer in one resume must belong to the same run')
    settled.push(clarification)
  }

  const sessionId = runId ? await deps.skillRunner.sessionIdFor(workspace, runId) : undefined
  if (!runId || !sessionId)
    throw new ValidationError('That run holds no conversation to continue, so the answer needs a fresh run')
  const records = await deps.runRepository.listRecords(workspace)
  const parked = records.find(record => record.runId === runId)
  if (!parked)
    throw new NotFoundError(`Run "${runId}" not found`)

  // The continuation carries the scope of the run it continues,
  // so a document being read stays attributed to the run reading it,
  // rather than to the sentence that released it.
  return {
    skillId: parked.skillId,
    resumeSessionId: sessionId,
    message: describeContinuation(settled),
    scope: runScope(parked),
    continues: parked.runId,
  }
}

/**
 * Close the stream, as a finish or as a wait.
 *
 * The translator cannot know which, since it reads one event at a time,
 * and the answer lives in the workspace rather than in the stream.
 */
async function writeTerminal(
  deps: AguiRouterDeps,
  stream: SSEStreamingApi,
  encoder: EventEncoder,
  translator: AguiTranslator,
  event: SkillEvent,
  workspaceId: WorkspaceId,
  runId: SkillRunIdType,
  threadId: string,
): Promise<void> {
  const interrupts = event.type === 'completed' && event.exitCode === 0
    ? await openInterrupts(deps, workspaceId, runId)
    : []
  if (interrupts.length === 0) {
    await writeAll(stream, encoder, translator, event)
    return
  }
  await stream.write(encoder.encodeSSE({
    type: EventType.RUN_FINISHED,
    threadId,
    runId,
    outcome: { type: 'interrupt', interrupts },
  }))
}

/**
 * Braid's runs, spoken as AG-UI.
 *
 * Outside the OpenAPI spec on purpose.
 * This is somebody else's protocol rather than part of Braid's REST surface,
 * and every operation in the spec is projected into MCP tools,
 * where an endpoint streaming a whole run would mean nothing to an agent.
 */
export function createAguiRouter(deps: AguiRouterDeps): Hono {
  const router = new Hono()

  // The protocol's own shape.
  // A client POSTs the conversation and reads the events,
  // which is what asking a question already was.
  router.post('/', async (context) => {
    const workspace = await loadWorkspaceById(getWorkspaceId(context), deps.workspaceRepository)
    const parsed = RunAgentInputSchema.safeParse(await context.req.json())
    if (!parsed.success)
      throw new ValidationError(`Not a RunAgentInput: ${parsed.error.message}`)
    const input = parsed.data

    const forwarded = (input.forwardedProps ?? {}) as { skillId?: unknown, resumeSessionId?: unknown }
    const resumed = await resolveResume(deps, workspace, input.resume ?? [])

    const skillId = resumed?.skillId
      ?? (typeof forwarded.skillId === 'string'
        ? SkillId.parse(forwarded.skillId)
        : (() => { throw new ValidationError('`forwardedProps.skillId` must name the skill to run') })())

    const messages = resumed
      ? [...toAgentMessages(input), { role: 'user' as const, content: resumed.message }]
      : toAgentMessages(input)
    const latest = messages.at(-1)
    if (!latest || latest.role !== 'user')
      throw new ValidationError('`messages` must end with the user message that starts this run')

    const resumeSessionId = resumed?.resumeSessionId
      ?? (typeof forwarded.resumeSessionId === 'string' ? forwarded.resumeSessionId : undefined)

    const callerToken = extractBearerToken(context)
    const runId = await deps.skillRunner.start(workspace, skillId, latest.content, {
      startedBy: getUserId(context),
      messages,
      ...(resumeSessionId ? { resumeSessionId } : {}),
      ...(resumed ? { scope: resumed.scope, continues: resumed.continues } : {}),
      ...(callerToken ? { callerToken } : {}),
    })

    const encoder = sseEncoder()
    const translator = new AguiTranslator(input.threadId, runId)
    return streamSSE(context, async (stream) => {
      // The run is already draining by the time `start` returns,
      // so anything emitted before this subscription lands is only in the log.
      // Backfilling to the subscription point is what makes the stream whole,
      // rather than whatever happened to arrive after the listener attached.
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
          if (event.type === 'completed') {
            await writeTerminal(deps, stream, encoder, translator, event, workspace.id, runId, input.threadId)
            queue.end()
            break
          }
          await writeAll(stream, encoder, translator, event)
        }
      }
      finally {
        unsubscribe()
      }
    })
  })

  // Reading an answer again, and rejoining one still being written,
  // are the same act, replaying the log and then keeping going if there is more.
  // The protocol has no endpoint for either, but the events are the protocol's,
  // so a client consumes this exactly as it consumes a live run.
  router.get('/runs/:runId', async (context) => {
    const workspace = await loadWorkspaceById(getWorkspaceId(context), deps.workspaceRepository)
    const runId = SkillRunId.parse(context.req.param('runId'))
    const threadId = context.req.query('threadId') ?? runId
    const encoder = sseEncoder()
    const translator = new AguiTranslator(threadId, runId)

    return streamSSE(context, async (stream) => {
      if (!deps.skillRunner.isActive(runId)) {
        for await (const event of deps.runRepository.readEvents(workspace, runId)) {
          if (event.type === 'completed') {
            await writeTerminal(deps, stream, encoder, translator, event, workspace.id, runId, threadId)
            continue
          }
          await writeAll(stream, encoder, translator, event)
        }
        return
      }

      // Subscribe before reading the log,
      // so the position snapshot says how much the live listener missed.
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
          if (event.type === 'completed') {
            await writeTerminal(deps, stream, encoder, translator, event, workspace.id, runId, threadId)
            queue.end()
            break
          }
          await writeAll(stream, encoder, translator, event)
        }
      }
      finally {
        unsubscribe()
      }
    })
  })

  return router
}
