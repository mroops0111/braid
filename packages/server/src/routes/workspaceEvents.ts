import type { WorkspaceEventBus } from '@braidhq/core'
import type { WorkspaceEvent } from '@braidhq/schema'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { createAsyncQueue } from '../infrastructure/skill/asyncQueue.js'
import { getWorkspaceId } from '../middleware/workspaceId.js'

export interface WorkspaceEventsRouterDeps {
  readonly eventBus: WorkspaceEventBus
}

/**
 * SSE endpoint the Studio opens once per workspace,
 * to invalidate react-query caches in real time.
 * Delivery is best-effort, events are dropped when no one is listening,
 * and the route makes no attempt to backfill state on connect.
 * The client re-fetches list endpoints on `EventSource.open`,
 * so a fresh subscriber catches up.
 */
export function createWorkspaceEventsRouter(deps: WorkspaceEventsRouterDeps): Hono {
  const router = new Hono()

  router.get('/', async (context) => {
    const workspaceId = getWorkspaceId(context)
    return streamSSE(context, async (stream) => {
      const queue = createAsyncQueue<WorkspaceEvent>()
      const unsubscribe = deps.eventBus.subscribe(workspaceId, (event) => {
        queue.push(event)
      })
      // Initial comment so the client's EventSource.onopen fires,
      // immediately even if no event has been published yet.
      await stream.writeSSE({ event: 'ready', data: JSON.stringify({ workspaceId }) })
      try {
        for await (const event of queue.iterate()) {
          await stream.writeSSE({ event: event.type, data: JSON.stringify(event) })
        }
      }
      finally {
        unsubscribe()
        queue.end()
      }
    })
  })

  return router
}
