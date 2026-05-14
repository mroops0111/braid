import type { PluginRegistry, WorkspaceRepository } from '@telos/core'
import { NotFoundError } from '@telos/core'
import { WorkspaceId } from '@telos/schema'
import { Hono } from 'hono'

export interface OntologyRouterDeps {
  workspaceRepository: WorkspaceRepository
  pluginRegistry: PluginRegistry
}

export function createOntologyRouter(deps: OntologyRouterDeps): Hono {
  const router = new Hono()

  router.get('/', async (context) => {
    const workspaceId = WorkspaceId.parse(context.req.param('workspaceId'))
    const workspaces = await deps.workspaceRepository.list()
    const workspace = workspaces.find(ws => ws.id === workspaceId)
    if (!workspace)
      throw new NotFoundError(`Workspace "${workspaceId}" not registered`)
    const ontology = deps.pluginRegistry.requireOntology(workspace.productManifest.ontologyId)
    return context.json({
      ontologyId: ontology.ontologyId,
      nodeTypes: ontology.nodeTypes,
      edgeTypes: ontology.edgeTypes,
    })
  })

  return router
}
