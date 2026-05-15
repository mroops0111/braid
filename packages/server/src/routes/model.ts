import type { ModelService } from '@telos/core'
import { Hono } from 'hono'
import { getWorkspaceId } from '../middleware/workspaceId.js'

export interface ModelRouterDeps {
  modelService: ModelService
}

export function createModelRouter(deps: ModelRouterDeps): Hono {
  const router = new Hono()

  router.get('/snapshot', async (context) => {
    const workspaceId = getWorkspaceId(context)
    const snapshot = await deps.modelService.getSnapshot(workspaceId)
    return context.json(snapshot)
  })

  return router
}
