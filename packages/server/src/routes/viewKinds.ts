import type { ViewService } from '@braidhq/core'
import { ListViewKindsResponse } from '@braidhq/schema'
import { createRoute, OpenAPIHono } from '@hono/zod-openapi'

export interface ViewKindsRouterDeps {
  viewService: ViewService
}

const listViewKindsRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listViewKinds',
  summary: 'List the kinds of document this server can write, and the forms of each.',
  description: 'A surface reads this to offer the forms and whatever each one asks, so a plugin shipping a fourth form reaches the reader who would have asked for it without the surface being changed.',
  tags: ['plugins'],
  responses: {
    200: {
      description: 'View generators currently registered.',
      content: { 'application/json': { schema: ListViewKindsResponse } },
    },
  },
})

export function createViewKindsRouter(deps: ViewKindsRouterDeps): OpenAPIHono {
  const router = new OpenAPIHono()

  router.openapi(listViewKindsRoute, (context) => {
    return context.json(ListViewKindsResponse.parse({ items: deps.viewService.kinds() }), 200)
  })

  return router
}
