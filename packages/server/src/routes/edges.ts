import type { ModelService } from '@braidhq/core'
import { EdgeTypeId, NodeId } from '@braidhq/schema'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { getWorkspaceId } from '../middleware/workspaceId.js'

const ListQuerySchema = z.object({
  type: z.union([EdgeTypeId, z.array(EdgeTypeId)]).optional(),
  fromNodeId: NodeId.optional(),
  toNodeId: NodeId.optional(),
  limit: z.coerce.number().int().positive().optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
})

export interface EdgesRouterDeps {
  modelService: ModelService
}

export function createEdgesRouter(deps: EdgesRouterDeps): Hono {
  const router = new Hono()

  router.get('/', zValidator('query', ListQuerySchema), async (context) => {
    const workspaceId = getWorkspaceId(context)
    const { type, fromNodeId, toNodeId, limit, offset } = context.req.valid('query')
    const types = type === undefined ? undefined : Array.isArray(type) ? type : [type]
    const edges = await deps.modelService.listEdges(workspaceId, {
      types,
      fromNodeId,
      toNodeId,
      limit,
      offset,
    })
    return context.json({ items: edges })
  })

  return router
}
