import type { User, WorkspaceMember } from '@braidhq/schema'
import type { ViewerContext, ViewerResource } from './ViewerContext.js'

/**
 * The sole place server-admin promotion happens. Every other layer,
 * including middleware, capability checks, and the Studio mirror,
 * consumes the resulting `effectiveRole` and never re-derives it.
 *
 * Resolution runs in order:
 *   1. An admin serverRole yields an owner effectiveRole.
 *      The stored member.role, if any, stays on `member` for display,
 *      yet gates ignore it.
 *   2. A present member yields effectiveRole = member.role.
 *   3. Otherwise effectiveRole is null, meaning no access.
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
