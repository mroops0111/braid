import type {
  RunRepository,
  SkillRunner,
  WorkspaceRepository,
} from '@braidhq/core'
import type { SessionMetadata, SkillEvent } from '@braidhq/schema'
import { ConflictError, NotFoundError, ValidationError } from '@braidhq/core'
import { SkillRunId } from '@braidhq/schema'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import { createAsyncQueue } from '../infrastructure/skill/asyncQueue.js'
import { getWorkspaceId } from '../middleware/workspaceId.js'
import { loadWorkspaceById } from './helpers.js'

export interface RunsRouterDeps {
  readonly runRepository: RunRepository
  readonly skillRunner: SkillRunner
  readonly workspaceRepository: WorkspaceRepository
}

export function createRunsRouter(deps: RunsRouterDeps): Hono {
  const router = new Hono()

  router.get('/', async (context) => {
    const workspace = await loadWorkspaceById(getWorkspaceId(context), deps.workspaceRepository)
    const items = await deps.runRepository.listRecords(workspace)
    return context.json({ items })
  })

  // Replay the persisted JSONL log,
  // and if the run is still active, tail new events as they arrive.
  // Clients can open, close, and reopen this stream freely,
  // the underlying subprocess and event log are untouched.
  router.get('/:runId/events', async (context) => {
    const workspace = await loadWorkspaceById(getWorkspaceId(context), deps.workspaceRepository)
    const runId = SkillRunId.parse(context.req.param('runId'))

    return streamSSE(context, async (stream) => {
      if (!deps.skillRunner.isActive(runId)) {
        for await (const event of deps.runRepository.readEvents(workspace, runId)) {
          await stream.writeSSE({ event: event.type, data: JSON.stringify(event) })
        }
        return
      }

      // Subscribe BEFORE reading JSONL.
      // The positionAtSubscribe count snapshots how many events were persisted,
      // so we read exactly that many from disk,
      // and rely on the live listener for everything after.
      const queue = createAsyncQueue<SkillEvent>()
      const { unsubscribe, positionAtSubscribe } = deps.skillRunner.subscribe(runId, (event) => {
        queue.push(event)
      })

      try {
        let delivered = 0
        for await (const event of deps.runRepository.readEvents(workspace, runId)) {
          if (delivered >= positionAtSubscribe)
            break
          await stream.writeSSE({ event: event.type, data: JSON.stringify(event) })
          delivered++
        }

        for await (const event of queue.iterate()) {
          await stream.writeSSE({ event: event.type, data: JSON.stringify(event) })
          if (event.type === 'completed' || event.type === 'error') {
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

  // SIGTERM the underlying claude subprocess.
  // The drain loop emits a `completed` event with the real exit code,
  // which the SSE tailers receive normally. 404 if the run already finished.
  router.post('/:runId/cancel', async (context) => {
    const runId = SkillRunId.parse(context.req.param('runId'))
    await deps.skillRunner.cancel(runId)
    return context.body(null, 204)
  })

  router.delete('/sessions/:sessionId', async (context) => {
    const sessionId = context.req.param('sessionId')
    if (!sessionId)
      throw new NotFoundError('Query parameter sessionId is required')
    await deps.skillRunner.forgetSession(sessionId)
    // `?purge=true` also drops the persisted run records and event logs,
    // matching the workspace-level `?purge=true` pattern.
    // Used by the Studio's per-conversation Delete action.
    // Without purge it keeps the lightweight `forgetSession` semantics,
    // which "New conversation" relies on.
    if (context.req.query('purge') === 'true') {
      const workspace = await loadWorkspaceById(getWorkspaceId(context), deps.workspaceRepository)
      const all = await deps.runRepository.listRecords(workspace)
      const targets = all.filter(r => r.sessionId === sessionId).map(r => r.runId)
      const active = targets.find(id => deps.skillRunner.isActive(id))
      if (active)
        throw new ConflictError(`Cannot delete session "${sessionId}": run "${active}" is still active`)
      await deps.runRepository.deleteRecords(workspace, targets)
    }
    return context.body(null, 204)
  })

  // Single-run delete, used by orphan Conversations rows,
  // that have no sessionId to anchor against.
  // Refuses to touch an in-flight run.
  router.delete('/:runId', async (context) => {
    const runId = SkillRunId.parse(context.req.param('runId'))
    if (deps.skillRunner.isActive(runId))
      throw new ConflictError(`Run "${runId}" is still active`)
    const workspace = await loadWorkspaceById(getWorkspaceId(context), deps.workspaceRepository)
    await deps.runRepository.deleteRecords(workspace, [runId])
    return context.body(null, 204)
  })

  const SessionPatchBody = z.object({
    // `null` clears the custom title (UI falls back to the first prompt).
    title: z.string().min(1).max(200).nullable(),
  })

  router.get('/sessions', async (context) => {
    const workspace = await loadWorkspaceById(getWorkspaceId(context), deps.workspaceRepository)
    const items = await deps.runRepository.listSessionMetadata(workspace)
    return context.json({ items })
  })

  router.patch('/sessions/:sessionId', async (context) => {
    const sessionId = context.req.param('sessionId')
    if (!sessionId)
      throw new NotFoundError('Query parameter sessionId is required')
    const body = await context.req.json().catch(() => null)
    const parsed = SessionPatchBody.safeParse(body)
    if (!parsed.success)
      throw new ValidationError(parsed.error.issues.map(i => i.message).join('; '))
    const workspace = await loadWorkspaceById(getWorkspaceId(context), deps.workspaceRepository)
    const metadata: SessionMetadata = {
      sessionId,
      title: parsed.data.title,
      updatedAt: new Date().toISOString(),
    }
    await deps.runRepository.saveSessionMetadata(workspace, metadata)
    return context.json(metadata)
  })

  return router
}
