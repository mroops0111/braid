import type { PluginRegistry } from '@braidhq/core'
import { ListSourceLoadersResponse } from '@braidhq/schema'
import { createRoute, OpenAPIHono } from '@hono/zod-openapi'

export interface SourceLoadersRouterDeps {
  pluginRegistry: PluginRegistry
}

const listSourceLoadersRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listSourceLoaders',
  summary: 'List source-loader plugins registered on this server.',
  description: 'Studio uses this to populate its loader dropdown without hardcoding `git / github / gdrive`. The list reflects what `composeFsApp` registered plus any `extraSourceLoaderPlugins` the caller passed in. The `manual` choice in the Studio UI is not a plugin and is not returned here.',
  tags: ['plugins'],
  responses: {
    200: {
      description: 'Source-loader plugins currently registered.',
      content: { 'application/json': { schema: ListSourceLoadersResponse } },
    },
  },
})

export function createSourceLoadersRouter(deps: SourceLoadersRouterDeps): OpenAPIHono {
  const router = new OpenAPIHono()

  router.openapi(listSourceLoadersRoute, (context) => {
    const plugins = deps.pluginRegistry.sourceLoaders()
    const loaders = plugins.map(plugin => ({
      kind: plugin.kind,
      pluginId: plugin.id,
      webhook: plugin.webhook !== undefined,
    }))
    return context.json(ListSourceLoadersResponse.parse({ loaders }), 200)
  })

  return router
}
