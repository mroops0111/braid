import type { WorkspaceEvent, WorkspaceEventBus } from '@telos/core'
import { WorkspaceId } from '@telos/schema'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { createAsyncQueue } from '../infrastructure/agent/asyncQueue.js'

export interface WorkspaceEventsRouterDeps {
  readonly eventBus: WorkspaceEventBus
}

/**
 * SSE endpoint the Studio opens once per workspace to invalidate
 * react-query caches in real time. Pure delivery: events are dropped if
 * no one is listening, and the route makes no attempt to backfill state
 * on connect. The client re-fetches list endpoints on `EventSource.open`
 * so a fresh subscriber catches up.
 */
export function createWorkspaceEventsRouter(deps: WorkspaceEventsRouterDeps): Hono {
  const router = new Hono()

  router.get('/:workspaceId/events', async (context) => {
    const workspaceId = WorkspaceId.parse(context.req.param('workspaceId'))
    return streamSSE(context, async (stream) => {
      const queue = createAsyncQueue<WorkspaceEvent>()
      const unsubscribe = deps.eventBus.subscribe(workspaceId, (event) => {
        queue.push(event)
      })
      // Initial comment so the client's EventSource.onopen fires
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
