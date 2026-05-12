import type { WorkspaceId } from '@telos/schema'
import { NotFoundError } from '@telos/core'

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
