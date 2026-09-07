import type { AbsolutePath, Timestamp, User, UserId, Workspace } from '@braidhq/schema'
import type { WorkspaceRegistryFile } from '../workspace/WorkspaceRegistryFile.js'

/**
 * Whether a workspace opens itself to the domain this address belongs to.
 *
 * Matches the part after the last `@`, case insensitively, so `Ada@Kdan.com`
 * reaches a workspace that named `kdan.com`. An address carrying no domain
 * matches nothing rather than matching everything.
 */
export function domainIsOpen(email: string, openToDomains: readonly string[]): boolean {
  const at = email.lastIndexOf('@')
  if (at < 0 || at === email.length - 1)
    return false
  const domain = email.slice(at + 1).toLowerCase()
  return openToDomains.some(open => open.trim().toLowerCase() === domain)
}

export interface AutoJoinDeps {
  readonly registry: WorkspaceRegistryFile
  readonly now: () => Timestamp
}

/**
 * A user only reaches this path by their address, so one without an address
 * takes part in none of it. A service account is the case in point.
 */
type Joiner = Pick<User, 'id' | 'email'>

/**
 * Give one user guest membership of every workspace open to their domain.
 *
 * Called when a user first registers, and again when a workspace declares or
 * changes the domains it opens to. The second occasion is what lets a
 * workspace opened later gain the colleagues who were already here.
 *
 * Deliberately not called on every sign-in. An owner who removes a guest
 * means it, and re-running this each login would put them back.
 */
export async function autoJoinOpenWorkspaces(
  deps: AutoJoinDeps,
  user: Joiner,
  workspaces: readonly Workspace[],
): Promise<void> {
  if (!user.email)
    return
  const email = user.email
  for (const workspace of workspaces) {
    if (domainIsOpen(email, workspace.productManifest.openToDomains))
      await addGuestIfAbsent(deps, workspace.rootPath, user.id)
  }
}

/**
 * Give every user whose domain a workspace opens to guest membership of it.
 *
 * The mirror of the call above, for the moment a workspace opens rather than
 * the moment a user arrives.
 */
export async function autoJoinExistingUsers(
  deps: AutoJoinDeps,
  rootPath: AbsolutePath,
  openToDomains: readonly string[],
  users: readonly Joiner[],
): Promise<void> {
  for (const user of users) {
    if (user.email && domainIsOpen(user.email, openToDomains))
      await addGuestIfAbsent(deps, rootPath, user.id)
  }
}

/**
 * A user already holding any role keeps it.
 *
 * That matters for an owner whose address happens to match, who must not be
 * demoted to guest by a later settings change.
 */
async function addGuestIfAbsent(
  deps: AutoJoinDeps,
  rootPath: AbsolutePath,
  userId: UserId,
): Promise<void> {
  const existing = await deps.registry.getMember(rootPath, userId)
  if (existing)
    return
  await deps.registry.addMember(rootPath, {
    userId,
    role: 'guest',
    joinedAt: deps.now(),
  })
}
