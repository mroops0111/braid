import type { WorkspaceService } from '@braidhq/core'
import type { WorkspaceMember, WorkspaceRole as WorkspaceRoleType } from '@braidhq/schema'
import type { Context, MiddlewareHandler } from 'hono'
import type { WorkspaceRegistryFile } from '../infrastructure/fs/WorkspaceRegistryFile.js'
import type { UserRegistryFile } from '../infrastructure/users/UserRegistryFile.js'
import { getUserId } from './userId.js'
import { getWorkspaceId } from './workspaceId.js'

declare module 'hono' {
  interface ContextVariableMap {
    workspaceRole: WorkspaceRoleType
    // Full member record when the caller is an explicit member.
    // Absent for the admin-bypass path because there's no real member
    // entry — downstream gates that need skillOverrides must accept
    // `undefined` and fall back to the role-based default.
    workspaceMember?: WorkspaceMember
  }
}

export interface WorkspaceAccessOptions {
  readonly registry: WorkspaceRegistryFile
  readonly workspaceService: WorkspaceService
  /**
   * Server-wide admins bypass the membership check (they see every
   * workspace for support / oversight) and get a virtual `owner`
   * role on the request context so role-gated mutations still work.
   */
  readonly userRegistry?: UserRegistryFile
}

/**
 * Enforce workspace membership and stash the caller's role on the
 * request context. Runs AFTER `workspaceIdMiddleware` (needs the
 * resolved id) and AFTER `userIdMiddleware` / `authMiddleware`
 * (needs the resolved userId).
 *
 * Local-trust callers stamped as `local-user` still pass through
 * the membership check — by Phase C migration `local-user` is the
 * owner of every existing workspace, so this middleware is invisible
 * to the single-tenant install.
 */
export function workspaceAccessMiddleware(options: WorkspaceAccessOptions): MiddlewareHandler {
  return async (context, next) => {
    const workspaceId = getWorkspaceId(context)
    const userId = getUserId(context)
    const workspace = await options.workspaceService.findById(workspaceId)
    const member = await options.registry.getMember(workspace.rootPath, userId)
    if (member) {
      context.set('workspaceRole', member.role)
      context.set('workspaceMember', member)
      await next()
      return undefined
    }
    // Server admins bypass the membership check — they see every
    // workspace and get a virtual `owner` role so role-gated routes
    // still let them act. Useful for support / fix-it tasks; an
    // explicit member entry stays the preferred persistent path.
    const me = await options.userRegistry?.get(userId)
    if (me?.serverRole === 'admin') {
      context.set('workspaceRole', 'owner')
      await next()
      return undefined
    }
    return context.json(
      {
        type: 'about:blank',
        title: 'Forbidden',
        status: 403,
        detail: `You are not a member of workspace "${workspaceId}".`,
      },
      403,
      { 'Content-Type': 'application/problem+json' },
    )
  }
}

export function getWorkspaceRole(context: Context): WorkspaceRoleType {
  return context.get('workspaceRole')
}

export function getWorkspaceMember(context: Context): WorkspaceMember | undefined {
  return context.get('workspaceMember')
}

/**
 * Mutation guard: 403s unless the caller's workspace role is in the
 * allowed list. Composes after `workspaceAccessMiddleware` so the
 * role is already resolved. Read routes don't need this — being a
 * member at all is sufficient to read.
 */
export function requireWorkspaceRole(...allowed: readonly WorkspaceRoleType[]): MiddlewareHandler {
  const set = new Set(allowed)
  return async (context, next) => {
    const role = context.get('workspaceRole') as WorkspaceRoleType | undefined
    // No role on the context means `workspaceAccessMiddleware` wasn't
    // mounted (test composition without a workspaceRegistry, or a
    // pre-Phase-C boot). Treat that as "RBAC disabled" and let the
    // request through; production deployments always mount the
    // access middleware so the gate is real there.
    if (role === undefined) {
      await next()
      return undefined
    }
    if (!set.has(role)) {
      return context.json(
        {
          type: 'about:blank',
          title: 'Forbidden',
          status: 403,
          detail: `Your role ("${role}") cannot perform this action.`,
        },
        403,
        { 'Content-Type': 'application/problem+json' },
      )
    }
    await next()
    return undefined
  }
}
