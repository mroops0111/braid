import type { ModelService } from '@telos/core'
import { zValidator } from '@hono/zod-validator'
import { NodeId, NodeStatus, NodeTypeId } from '@telos/schema'
import { Hono } from 'hono'
import { z } from 'zod'
import { getWorkspaceId } from '../middleware/workspaceId.js'

const ListQuerySchema = z.object({
  type: z.union([NodeTypeId, z.array(NodeTypeId)]).optional(),
  status: z.union([NodeStatus, z.array(NodeStatus)]).optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().positive().optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
})

const ScopeQuerySchema = z.object({
  depth: z.coerce.number().int().positive().default(2),
})

export interface NodesRouterDeps {
  modelService: ModelService
}

export function createNodesRouter(deps: NodesRouterDeps): Hono {
  const router = new Hono()

  router.get('/', zValidator('query', ListQuerySchema), async (context) => {
    const workspaceId = getWorkspaceId(context)
    const { type, status, q, limit, offset } = context.req.valid('query')
    const types = type === undefined ? undefined : Array.isArray(type) ? type : [type]
    const statuses = status === undefined ? undefined : Array.isArray(status) ? status : [status]
    const nodes = await deps.modelService.findNodes(workspaceId, {
      types,
      statuses,
      nameContains: q,
      limit,
      offset,
    })
    return context.json({ items: nodes })
  })

  router.get('/:nodeId', async (context) => {
    const workspaceId = getWorkspaceId(context)
    const nodeId = NodeId.parse(context.req.param('nodeId'))
    const node = await deps.modelService.getNode(workspaceId, nodeId)
    return context.json(node)
  })

  router.get('/:nodeId/scope', zValidator('query', ScopeQuerySchema), async (context) => {
    const workspaceId = getWorkspaceId(context)
    const nodeId = NodeId.parse(context.req.param('nodeId'))
    const { depth } = context.req.valid('query')
    const snapshot = await deps.modelService.scopeOf(workspaceId, nodeId, depth)
    return context.json(snapshot)
  })

  return router
}
