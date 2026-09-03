import type { ModelService } from '@braidhq/core'
import { ModelSnapshot } from '@braidhq/schema'
import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import { getWorkspaceId } from '../middleware/workspaceId.js'
import { mcpReadTool, WorkspaceIdParam } from './_shared.js'

export interface ModelRouterDeps {
  modelService: ModelService
}

const getSnapshotRoute = createRoute(mcpReadTool({
  method: 'get',
  path: '/snapshot',
  operationId: 'getModelSnapshot',
  summary: 'Return the full graph snapshot (nodes + edges) for a workspace.',
  tags: ['model'],
  request: { params: WorkspaceIdParam },
  responses: {
    200: {
      description: 'The full graph snapshot.',
      content: { 'application/json': { schema: ModelSnapshot } },
    },
  },
// The tool says what the REST summary need not.
// A mature graph runs past a megabyte, and an MCP client pays that in context.
}, {
  description:
    'Return every node and edge in the workspace at once. A mature graph runs past a megabyte, '
    + 'which fills a context window on its own. Prefer `listNodes` with a filter, or `getNodeScope` '
    + 'around a starting node, unless the whole graph is genuinely needed.',
}))

export function createModelRouter(deps: ModelRouterDeps): OpenAPIHono {
  const router = new OpenAPIHono()

  router.openapi(getSnapshotRoute, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const snapshot = await deps.modelService.getSnapshot(workspaceId)
    return context.json(snapshot, 200)
  })

  return router
}
