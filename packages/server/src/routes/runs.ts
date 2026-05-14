import type {
  RunRepository,
  SkillRunner,
  Workspace,
  WorkspaceRepository,
} from '@telos/core'
import type { SkillEvent } from '@telos/schema'
import { NotFoundError } from '@telos/core'
import { SkillRunId, WorkspaceId } from '@telos/schema'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { createAsyncQueue } from '../infrastructure/agent/asyncQueue.js'

export interface RunsRouterDeps {
  readonly runRepository: RunRepository
  readonly skillRunner: SkillRunner
  readonly workspaceRepository: WorkspaceRepository
}

export function createRunsRouter(deps: RunsRouterDeps): Hono {
  const router = new Hono()

  router.get('/', async (context) => {
    const workspace = await loadWorkspaceForRequest(context.req.param('workspaceId'), deps.workspaceRepository)
    const items = await deps.runRepository.listRecords(workspace)
    return context.json({ items })
  })

  // Replay the persisted JSONL log and, if the run is still active, tail new
  // events as they arrive. Clients can open / close / reopen this stream
  // freely; the underlying subprocess and event log are not affected.
  router.get('/:runId/events', async (context) => {
    const workspace = await loadWorkspaceForRequest(context.req.param('workspaceId'), deps.workspaceRepository)
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

  router.delete('/sessions/:sessionId', async (context) => {
    const sessionId = context.req.param('sessionId')
    if (!sessionId)
      throw new NotFoundError('sessionId is required')
    await deps.skillRunner.forgetSession(sessionId)
    return context.body(null, 204)
  })

  return router
}

async function loadWorkspaceForRequest(
  rawWorkspaceId: string | undefined,
  workspaceRepository: WorkspaceRepository,
): Promise<Workspace> {
  const workspaceId = WorkspaceId.parse(rawWorkspaceId)
  const workspaces = await workspaceRepository.list()
  const match = workspaces.find(workspace => workspace.id === workspaceId)
  if (!match)
    throw new NotFoundError(`Workspace "${workspaceId}" not registered`)
  return match
}
