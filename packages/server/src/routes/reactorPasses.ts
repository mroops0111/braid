import type { ReactorPassRepository } from '@braidhq/core'
import { NotFoundError } from '@braidhq/core'
import { ReactorPass, ReactorPassId } from '@braidhq/schema'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { getWorkspaceId } from '../middleware/workspaceId.js'
import { NotFoundResponse, WorkspaceIdParam } from './_shared.js'

const PassIdParam = WorkspaceIdParam.extend({
  passId: ReactorPassId.openapi({ param: { name: 'passId', in: 'path' } }),
})

const ListResponse = z.object({
  items: z.array(ReactorPass),
}).openapi('ReactorPassListResponse')

export interface ReactorPassesRouterDeps {
  reactorPassRepository: ReactorPassRepository
}

const listRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listReactorPasses',
  summary: 'List reactor passes for a workspace, newest first.',
  description: 'One entry per reactor pass — the full timeline (units + checkpoint) is on each entry, so the Activity page does not need a second round-trip to render the list.',
  tags: ['reactor'],
  request: { params: WorkspaceIdParam },
  responses: {
    200: {
      description: 'The reactor passes recorded for this workspace.',
      content: { 'application/json': { schema: ListResponse } },
    },
  },
})

const getRoute = createRoute({
  method: 'get',
  path: '/{passId}',
  operationId: 'getReactorPass',
  summary: 'Fetch one reactor pass by id.',
  description: 'The Activity page subscribes to the workspace event stream and refreshes this endpoint whenever a `reactor.unit.*` or `reactor.checkpoint.*` event fires for the open pass.',
  tags: ['reactor'],
  request: { params: PassIdParam },
  responses: {
    200: {
      description: 'The pass record.',
      content: { 'application/json': { schema: ReactorPass } },
    },
    404: NotFoundResponse,
  },
})

export function createReactorPassesRouter(deps: ReactorPassesRouterDeps): OpenAPIHono {
  const router = new OpenAPIHono()

  router.openapi(listRoute, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const passes = await deps.reactorPassRepository.listByWorkspace(workspaceId)
    return context.json({ items: [...passes] }, 200)
  })

  router.openapi(getRoute, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const { passId } = context.req.valid('param')
    const pass = await deps.reactorPassRepository.load(workspaceId, passId)
    if (!pass)
      throw new NotFoundError(`reactor pass "${passId}" not found for workspace "${workspaceId}"`)
    return context.json(pass, 200)
  })

  return router
}
