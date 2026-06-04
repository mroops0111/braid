import type { BatchService } from '@braidhq/core'
import { NotFoundError } from '@braidhq/core'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { getWorkspaceId } from '../middleware/workspaceId.js'

const StartBody = z.object({
  autoApply: z.boolean(),
})

export interface BatchRouterDeps {
  batchService: BatchService
}

export function createBatchRouter(deps: BatchRouterDeps): Hono {
  const router = new Hono()

  router.post('/', zValidator('json', StartBody), async (context) => {
    const workspaceId = getWorkspaceId(context)
    const { autoApply } = context.req.valid('json')
    const plan = await deps.batchService.start(workspaceId, { autoApply })
    return context.json(plan.toData(), 202)
  })

  router.get('/', async (context) => {
    const workspaceId = getWorkspaceId(context)
    const plan = await deps.batchService.getStatus(workspaceId)
    if (!plan)
      throw new NotFoundError(`No batch plan for workspace ${workspaceId}`)
    return context.json(plan.toData())
  })

  router.post('/stop', async (context) => {
    const workspaceId = getWorkspaceId(context)
    await deps.batchService.stop(workspaceId)
    return context.body(null, 204)
  })

  router.post('/resume', async (context) => {
    const workspaceId = getWorkspaceId(context)
    const plan = await deps.batchService.resume(workspaceId)
    return context.json(plan.toData(), 202)
  })

  router.post('/archive', async (context) => {
    const workspaceId = getWorkspaceId(context)
    const plan = await deps.batchService.archive(workspaceId)
    return context.json(plan.toData())
  })

  return router
}
