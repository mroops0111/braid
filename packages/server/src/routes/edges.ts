import type { ModelService } from '@braidhq/core'
import { EdgeTypeId, GraphEdge, NodeId } from '@braidhq/schema'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { getWorkspaceId } from '../middleware/workspaceId.js'
import { ValidationFailureResponse, WorkspaceIdParam } from './_shared.js'

const ListQuery = z.object({
  type: z.union([EdgeTypeId, z.array(EdgeTypeId)]).optional().openapi({ description: 'Filter by edge type id; pass one or many.' }),
  fromNodeId: NodeId.optional()
    .openapi({ description: 'Filter to edges originating from this node.' }),
  toNodeId: NodeId.optional()
    .openapi({ description: 'Filter to edges terminating at this node.' }),
  limit: z.coerce.number().int().positive().optional().openapi({ description: 'Maximum number of edges to return.' }),
  offset: z.coerce.number().int().nonnegative().optional().openapi({ description: 'Number of edges to skip before returning.' }),
})

const EdgeListResponse = z.object({
  items: z.array(GraphEdge),
}).openapi('EdgeListResponse')

export interface EdgesRouterDeps {
  modelService: ModelService
}

const listEdgesRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listEdges',
  summary: 'List edges in the graph, optionally filtered by type / endpoint / pagination.',
  tags: ['edges'],
  request: {
    params: WorkspaceIdParam,
    query: ListQuery,
  },
  responses: {
    200: {
      description: 'A page of matching edges.',
      content: { 'application/json': { schema: EdgeListResponse } },
    },
    400: ValidationFailureResponse,
  },
})

export function createEdgesRouter(deps: EdgesRouterDeps): OpenAPIHono {
  const router = new OpenAPIHono()

  router.openapi(listEdgesRoute, async (context) => {
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
    return context.json({ items: edges }, 200)
  })

  return router
}
