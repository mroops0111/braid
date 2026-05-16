import type { Workspace, WorkspaceRepository } from '@braidhq/core'
import type { WorkspaceId } from '@braidhq/schema'
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
