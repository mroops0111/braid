import type { ModelService } from '@braidhq/core'
import { GraphNode, ModelSnapshot, NodeId, NodeStatus, NodeTypeId } from '@braidhq/schema'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { getWorkspaceId } from '../middleware/workspaceId.js'
import { NotFoundResponse, ValidationFailureResponse, WorkspaceIdParam } from './_shared.js'

const ListQuery = z.object({
  type: z.union([NodeTypeId, z.array(NodeTypeId)]).optional().openapi({ description: 'Filter by node type id. Pass one or many.' }),
  status: z.union([NodeStatus, z.array(NodeStatus)]).optional().openapi({ description: 'Filter by node status. Pass one or many.' }),
  q: z.string().optional().openapi({ description: 'Case-insensitive substring match against node name and description.' }),
})

const NodeIdParam = WorkspaceIdParam.extend({
  nodeId: NodeId.openapi({ param: { name: 'nodeId', in: 'path' } }),
})

const ScopeQuery = z.object({
  depth: z.coerce.number().int().positive().default(2).openapi({ description: 'How many hops to traverse from the seed node.' }),
})

const NodeListResponse = z.object({
  items: z.array(GraphNode),
}).openapi('NodeListResponse')

export interface NodesRouterDeps {
  modelService: ModelService
}

const listNodesRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listNodes',
  summary: 'Search graph nodes by type, status, and a substring of the name or description.',
  tags: ['nodes'],
  request: {
    params: WorkspaceIdParam,
    query: ListQuery,
  },
  responses: {
    200: {
      description: 'A page of matching nodes.',
      content: { 'application/json': { schema: NodeListResponse } },
    },
    400: ValidationFailureResponse,
  },
})

const getNodeRoute = createRoute({
  method: 'get',
  path: '/{nodeId}',
  operationId: 'getNode',
  summary: 'Fetch a single node by id.',
  tags: ['nodes'],
  request: { params: NodeIdParam },
  responses: {
    200: {
      description: 'The requested node.',
      content: { 'application/json': { schema: GraphNode } },
    },
    404: NotFoundResponse,
  },
})

const scopeRoute = createRoute({
  method: 'get',
  path: '/{nodeId}/scope',
  operationId: 'getNodeScope',
  summary: 'Return the subgraph reachable from a node within a depth budget.',
  tags: ['nodes'],
  request: {
    params: NodeIdParam,
    query: ScopeQuery,
  },
  responses: {
    200: {
      description: 'A scoped subgraph (nodes + edges) around the seed node.',
      content: { 'application/json': { schema: ModelSnapshot } },
    },
    404: NotFoundResponse,
  },
})

export function createNodesRouter(deps: NodesRouterDeps): OpenAPIHono {
  const router = new OpenAPIHono()

  router.openapi(listNodesRoute, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const { type, status, q } = context.req.valid('query')
    const types = type === undefined ? undefined : Array.isArray(type) ? type : [type]
    const statuses = status === undefined ? undefined : Array.isArray(status) ? status : [status]
    const nodes = await deps.modelService.listNodes(workspaceId, {
      types,
      statuses,
      textContains: q,
    })
    return context.json({ items: nodes }, 200)
  })

  router.openapi(getNodeRoute, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const { nodeId } = context.req.valid('param')
    const node = await deps.modelService.getNode(workspaceId, nodeId)
    return context.json(node, 200)
  })

  router.openapi(scopeRoute, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const { nodeId } = context.req.valid('param')
    const { depth } = context.req.valid('query')
    const snapshot = await deps.modelService.scopeOf(workspaceId, nodeId, depth)
    return context.json(snapshot, 200)
  })

  return router
}
