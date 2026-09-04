import type { OntologyLookupDeps } from './_ontology.js'
import { OntologyResponse } from '@braidhq/schema'
import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import { getWorkspaceId } from '../middleware/workspaceId.js'
import { ontologyFor } from './_ontology.js'
import { mcpReadTool, NotFoundResponse, WorkspaceIdParam } from './_shared.js'

export type OntologyRouterDeps = OntologyLookupDeps

const getOntologyRoute = createRoute(mcpReadTool({
  method: 'get',
  path: '/',
  operationId: 'getOntology',
  summary: 'Return the active ontology (node types, edge types, source roles) for a workspace.',
  tags: ['ontology'],
  request: { params: WorkspaceIdParam },
  responses: {
    200: {
      description: 'The active ontology for the workspace.',
      content: { 'application/json': { schema: OntologyResponse } },
    },
    404: NotFoundResponse,
  },
}))

export function createOntologyRouter(deps: OntologyRouterDeps): OpenAPIHono {
  const router = new OpenAPIHono()

  router.openapi(getOntologyRoute, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const ontology = await ontologyFor(deps, workspaceId)
    return context.json(OntologyResponse.parse({
      ontologyId: ontology.ontologyId,
      nodeTypes: ontology.nodeTypes,
      edgeTypes: ontology.edgeTypes,
      sourceRoles: ontology.sourceRoles,
    }), 200)
  })

  return router
}
