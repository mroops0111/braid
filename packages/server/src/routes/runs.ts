import type {
  RunRepository,
  SkillRunner,
  WorkspaceRepository,
} from '@braidhq/core'
import type { SkillEvent } from '@braidhq/schema'
import { NotFoundError } from '@braidhq/core'
import { SkillRunId } from '@braidhq/schema'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { createAsyncQueue } from '../infrastructure/agent/asyncQueue.js'
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

  // Replay the persisted JSONL log and, if the run is still active, tail new
  // events as they arrive. Clients can open / close / reopen this stream
  // freely; the underlying subprocess and event log are not affected.
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

      // Subscribe BEFORE reading JSONL. positionAtSubscribe is the snapshot of
      // how many events were already persisted, so we read exactly that many
      // from disk and rely on the live listener for everything from there on.
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

  // SIGTERM the underlying claude subprocess. The drain loop emits a
  // `completed` event with the actual exit code, which the SSE tailers
  // receive normally. 404 if the run already finished.
  router.post('/:runId/cancel', async (context) => {
    const runId = SkillRunId.parse(context.req.param('runId'))
    await deps.skillRunner.cancel(runId)
    return context.body(null, 204)
  })

  router.delete('/sessions/:sessionId', async (context) => {
    const sessionId = context.req.param('sessionId')
    if (!sessionId)
      throw new NotFoundError('sessionId is required')
    await deps.skillRunner.forgetSession(sessionId)
    return context.body(null, 204)
  })

  return router
}
