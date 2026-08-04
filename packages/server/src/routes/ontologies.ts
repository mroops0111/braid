import type { PluginRegistry } from '@braidhq/core'
import { OntologyListResponse } from '@braidhq/schema'
import { createRoute, OpenAPIHono } from '@hono/zod-openapi'

export interface OntologiesRouterDeps {
  pluginRegistry: PluginRegistry
}

const listRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listOntologies',
  summary: 'List every registered ontology (node types, edge types, source roles).',
  tags: ['ontology'],
  responses: {
    200: {
      description: 'The registered ontologies.',
      content: { 'application/json': { schema: OntologyListResponse } },
    },
  },
})

export function createOntologiesRouter(deps: OntologiesRouterDeps): OpenAPIHono {
  const router = new OpenAPIHono()

  router.openapi(listRoute, (context) => {
    const ontologies = deps.pluginRegistry.ontologies().map(ontology => ({
      ontologyId: ontology.ontologyId,
      nodeTypes: ontology.nodeTypes,
      edgeTypes: ontology.edgeTypes,
      sourceRoles: ontology.sourceRoles,
    }))
    return context.json(OntologyListResponse.parse({ ontologies }), 200)
  })

  return router
}
