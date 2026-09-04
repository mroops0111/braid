import type { OntologyPlugin, PluginRegistry, WorkspaceRepository } from '@braidhq/core'
import type { WorkspaceId } from '@braidhq/schema'
import { NotFoundError } from '@braidhq/core'

/**
 * What a workspace answers to, so a route can check a request against it.
 *
 * A workspace names its ontology, which is why this takes a workspace rather
 * than reading a deployment-wide default. Two workspaces on one server may
 * speak different vocabularies, and a caller's `type=aggregate` is only
 * meaningful against the one that defines it.
 */
export interface OntologyLookupDeps {
  workspaceRepository: WorkspaceRepository
  pluginRegistry: PluginRegistry
}

export async function ontologyFor(
  deps: OntologyLookupDeps,
  workspaceId: WorkspaceId,
): Promise<OntologyPlugin> {
  const workspaces = await deps.workspaceRepository.list()
  const workspace = workspaces.find(candidate => candidate.id === workspaceId)
  if (!workspace)
    throw new NotFoundError(`Workspace "${workspaceId}" not registered`)
  return deps.pluginRegistry.requireOntology(workspace.productManifest.ontologyId)
}
