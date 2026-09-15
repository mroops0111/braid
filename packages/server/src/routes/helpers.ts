import type { PluginRegistry, Workspace, WorkspaceRepository } from '@braidhq/core'
import type { SkillId, WorkspaceId } from '@braidhq/schema'
import { NotFoundError } from '@braidhq/core'

export function assertEntityInWorkspace(
  expected: WorkspaceId,
  actual: WorkspaceId,
  entityKind: string,
  entityId: string,
): void {
  if (expected !== actual) {
    throw new NotFoundError(`${entityKind} "${entityId}" not found in workspace "${expected}"`)
  }
}

export async function loadWorkspaceById(
  workspaceId: WorkspaceId,
  workspaceRepository: WorkspaceRepository,
): Promise<Workspace> {
  const workspaces = await workspaceRepository.list()
  const match = workspaces.find(workspace => workspace.id === workspaceId)
  if (!match)
    throw new NotFoundError(`Workspace "${workspaceId}" not registered`)
  return match
}

/**
 * The skill a batch runs once per document, declared by the ontology.
 *
 * Absent means this ontology has no per-unit step,
 * so there is nothing for a batch to run and nothing to authorise.
 */
export function resolvePerUnitSkillId(pluginRegistry: PluginRegistry, workspace: Workspace): SkillId | undefined {
  const ontology = pluginRegistry.findOntology(workspace.productManifest.ontologyId)
  return ontology?.batch?.perUnit?.skillId
}
