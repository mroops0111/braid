import type { User, WorkspaceMember } from '@braidhq/schema'
import type { ViewerContext, ViewerResource } from './ViewerContext'

/**
 * The sole place an admin is promoted to owner on the client.
 * Mirrors the server's resolveViewer so the two stay in lock-step.
 */
export function resolveViewer(
  user: User,
  member: WorkspaceMember | undefined,
  resource?: ViewerResource,
): ViewerContext {
  if (user.serverRole === 'admin') {
    return {
      user,
      member,
      effectiveRole: 'owner',
      ...(resource ? { resource } : {}),
    }
  }
  if (member) {
    return {
      user,
      member,
      effectiveRole: member.role,
      ...(resource ? { resource } : {}),
    }
  }
  return {
    user,
    member: undefined,
    effectiveRole: null,
    ...(resource ? { resource } : {}),
  }
}
