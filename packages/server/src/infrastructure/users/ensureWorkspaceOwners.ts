import type { Timestamp, UserId } from '@braidhq/schema'
import type { WorkspaceRegistryFile } from '../fs/WorkspaceRegistryFile.js'

/**
 * Give every ownerless workspace a default owner.
 * A workspace registered before the member model has an empty `members[]`.
 * Single-tenant seeds `defaultOwner` so the install keeps working untouched.
 * Multi-tenant passes null, where an ownerless workspace is a fault,
 * every workspace there is created with an explicit owner, so this throws.
 * Idempotent, workspaces that already have members are left alone.
 */
export async function ensureWorkspaceOwners(
  registry: WorkspaceRegistryFile,
  defaultOwner: UserId | null,
): Promise<void> {
  const rootPaths = await registry.list()
  const now = new Date().toISOString() as Timestamp
  for (const rootPath of rootPaths) {
    const members = await registry.listMembers(rootPath)
    if (members.length > 0)
      continue
    if (defaultOwner === null)
      throw new Error(`Workspace at ${rootPath} has no owner, a multi-tenant server requires an explicit owner.`)
    await registry.addMember(rootPath, {
      userId: defaultOwner,
      role: 'owner',
      joinedAt: now,
    })
  }
}
