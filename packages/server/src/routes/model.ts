import type { ModelService } from '@braidhq/core'
import { ModelSnapshot } from '@braidhq/schema'
import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import { getWorkspaceId } from '../middleware/workspaceId.js'
import { WorkspaceIdParam } from './_shared.js'

export interface ModelRouterDeps {
  modelService: ModelService
}

// Deliberately not an MCP tool. A mature graph runs past a megabyte,
// so a model that reached for it would spend its whole context on one call,
// and a filtered `listNodes` or `getNodeScope` answers what it would ask.
// Studio still needs the whole thing.
const getSnapshotRoute = createRoute({
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
})

export function createModelRouter(deps: ModelRouterDeps): OpenAPIHono {
  const router = new OpenAPIHono()

  router.openapi(getSnapshotRoute, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const snapshot = await deps.modelService.getSnapshot(workspaceId)
    return context.json(snapshot, 200)
  })

  return router
}
