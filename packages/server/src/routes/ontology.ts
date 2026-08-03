import type { PluginRegistry, WorkspaceRepository } from '@braidhq/core'
import { NotFoundError } from '@braidhq/core'
import { OntologyResponse } from '@braidhq/schema'
import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import { getWorkspaceId } from '../middleware/workspaceId.js'
import { NotFoundResponse, WorkspaceIdParam } from './_shared.js'

export interface OntologyRouterDeps {
  workspaceRepository: WorkspaceRepository
  pluginRegistry: PluginRegistry
}

const getOntologyRoute = createRoute({
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
})

export function createOntologyRouter(deps: OntologyRouterDeps): OpenAPIHono {
  const router = new OpenAPIHono()

  router.openapi(getOntologyRoute, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const workspaces = await deps.workspaceRepository.list()
    const workspace = workspaces.find(ws => ws.id === workspaceId)
    if (!workspace)
      throw new NotFoundError(`Workspace "${workspaceId}" not registered`)
    const ontology = deps.pluginRegistry.requireOntology(workspace.productManifest.ontologyId)
    return context.json(OntologyResponse.parse({
      ontologyId: ontology.ontologyId,
      nodeTypes: ontology.nodeTypes,
      edgeTypes: ontology.edgeTypes,
      sourceRoles: ontology.sourceRoles,
    }), 200)
  })

  return router
}
