import type { Timestamp } from '@braidhq/schema'
import type { WorkspaceRegistryFile } from '../fs/WorkspaceRegistryFile.js'
import { LOCAL_USER_ID } from './ensureLocalUser.js'

/**
 * Phase C migration: workspaces registered before members existed have
 * empty `members[]`. Seed each one with `local-user` as owner so the
 * single-tenant install keeps working with no manual steps. Idempotent
 * — workspaces that already have members are left alone.
 */
export async function ensureWorkspaceOwners(registry: WorkspaceRegistryFile): Promise<void> {
  const rootPaths = await registry.list()
  const now = new Date().toISOString() as Timestamp
  for (const rootPath of rootPaths) {
    const members = await registry.listMembers(rootPath)
    if (members.length > 0)
      continue
    await registry.addMember(rootPath, {
      userId: LOCAL_USER_ID,
      role: 'owner',
      joinedAt: now,
    })
  }
}
