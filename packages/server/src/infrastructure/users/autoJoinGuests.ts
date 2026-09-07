import type { AbsolutePath, Timestamp, User, UserId, Workspace } from '@braidhq/schema'
import type { WorkspaceRegistryFile } from '../workspace/WorkspaceRegistryFile.js'

export interface AutoJoinDeps {
  readonly registry: WorkspaceRegistryFile
  readonly now: () => Timestamp
}

type Joiner = Pick<User, 'id' | 'kind'>

/**
 * A service account is a component of the deployment, not a colleague,
 * so it never picks up membership this way.
 * The reactor is the one in the tree,
 * and it reaches a workspace through its own token.
 */
function isPerson(user: Joiner): boolean {
  return user.kind !== 'service'
}

/**
 * Give one user membership of every workspace that admits arrivals.
 *
 * Called at first registration, and again when a workspace starts admitting,
 * which is what reaches the colleagues who were already here.
 *
 * Not called on every sign-in. An owner who removes a member means it,
 * and running this at each login would put them back.
 */
export async function autoJoinOpenWorkspaces(
  deps: AutoJoinDeps,
  user: Joiner,
  workspaces: readonly Workspace[],
): Promise<void> {
  if (!isPerson(user))
    return
  for (const workspace of workspaces) {
    const role = workspace.productManifest.autoJoinAs
    if (role)
      await addIfAbsent(deps, workspace.rootPath, user.id, role)
  }
}

/**
 * Give every registered user membership of a workspace that just opened.
 *
 * The mirror of the call above, for the moment a workspace opens,
 * rather than the moment a user arrives.
 */
export async function autoJoinExistingUsers(
  deps: AutoJoinDeps,
  rootPath: AbsolutePath,
  role: 'guest' | undefined,
  users: readonly Joiner[],
): Promise<void> {
  if (!role)
    return
  for (const user of users) {
    if (isPerson(user))
      await addIfAbsent(deps, rootPath, user.id, role)
  }
}

/**
 * A user already holding any role keeps it.
 *
 * That matters for an owner of a workspace that later starts admitting,
 * who must not be demoted by a setting meant for newcomers.
 */
async function addIfAbsent(
  deps: AutoJoinDeps,
  rootPath: AbsolutePath,
  userId: UserId,
  role: 'guest',
): Promise<void> {
  const existing = await deps.registry.getMember(rootPath, userId)
  if (existing)
    return
  await deps.registry.addMember(rootPath, {
    userId,
    role,
    joinedAt: deps.now(),
  })
}
