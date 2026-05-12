import type { ModelService } from '@telos/core'
import { WorkspaceId } from '@telos/schema'
import { Hono } from 'hono'

export interface ModelRouterDeps {
  modelService: ModelService
}

export function createModelRouter(deps: ModelRouterDeps): Hono {
  const router = new Hono()

  router.get('/snapshot', async (context) => {
    const workspaceId = WorkspaceId.parse(context.req.param('workspaceId'))
    const snapshot = await deps.modelService.getSnapshot(workspaceId)
    return context.json(snapshot)
  })

  return router
}
