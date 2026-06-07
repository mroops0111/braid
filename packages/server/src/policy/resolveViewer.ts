import type { User, WorkspaceMember } from '@braidhq/schema'
import type { ViewerContext, ViewerResource } from './ViewerContext.js'

/**
 * The sole place server-admin promotion happens. Every other layer
 * (middleware, capability checks, Studio mirror) consumes the resulting
 * `effectiveRole` and never re-derives it.
 *
 * Resolution:
 *   1. user.serverRole === 'admin'  → effectiveRole = 'owner'
 *      (the stored member.role, if any, is kept on `member` for
 *      display, but ignored by gates)
 *   2. member present                → effectiveRole = member.role
 *   3. otherwise                     → effectiveRole = null (no access)
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
