import type { SourceUnitStateService } from '@braidhq/core'
import { SourceId, SourceUnitState } from '@braidhq/schema'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { getWorkspaceId } from '../middleware/workspaceId.js'
import { ValidationFailureResponse, WorkspaceIdParam } from './_shared.js'

const ListQuery = z.object({
  sourceId: SourceId.optional().openapi({ description: 'Restrict to one source.' }),
})

const ListResponse = z.object({
  items: z.array(SourceUnitState),
}).openapi('SourceUnitStateListResponse')

export interface SourceUnitStatesRouterDeps {
  sourceUnitStateService: SourceUnitStateService
}

const listRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listSourceUnitStates',
  summary: 'List recorded observations per source unit for a workspace.',
  description: 'Returns the framework\'s current view of each source unit '
    + 'last seen by an extract run. One entry per (sourceId, path). Used '
    + 'by Studio to display per-unit freshness and by Reactor to compute '
    + 'what needs re-extraction.',
  tags: ['source-unit-states'],
  request: {
    params: WorkspaceIdParam,
    query: ListQuery,
  },
  responses: {
    200: {
      description: 'The recorded observations.',
      content: { 'application/json': { schema: ListResponse } },
    },
    400: ValidationFailureResponse,
  },
})

export function createSourceUnitStatesRouter(deps: SourceUnitStatesRouterDeps): OpenAPIHono {
  const router = new OpenAPIHono()

  router.openapi(listRoute, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const { sourceId } = context.req.valid('query')
    const items = sourceId
      ? await deps.sourceUnitStateService.listBySource(workspaceId, sourceId)
      : await deps.sourceUnitStateService.listByWorkspace(workspaceId)
    return context.json({ items: [...items] }, 200)
  })

  return router
}
