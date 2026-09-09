import type { PluginRegistry } from '@braidhq/core'
import { ListAgentsResponse } from '@braidhq/schema'
import { createRoute, OpenAPIHono } from '@hono/zod-openapi'

export interface AgentsRouterDeps {
  pluginRegistry: PluginRegistry
}

const listAgentsRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listAgents',
  summary: 'List agent plugins registered on this server.',
  description: 'Studio reads this so its settings page never names an agent it does not depend on. A skill may name any of these kinds in its frontmatter, and a person may hold one credential per kind.',
  tags: ['plugins'],
  responses: {
    200: {
      description: 'Agent plugins currently registered.',
      content: { 'application/json': { schema: ListAgentsResponse } },
    },
  },
})

export function createAgentsRouter(deps: AgentsRouterDeps): OpenAPIHono {
  const router = new OpenAPIHono()

  router.openapi(listAgentsRoute, (context) => {
    const agents = deps.pluginRegistry.agentPlugins().map(plugin => ({
      kind: plugin.kind,
      ...(plugin.credentialCommand ? { credentialCommand: plugin.credentialCommand } : {}),
    }))
    return context.json(ListAgentsResponse.parse({ agents }), 200)
  })

  return router
}
