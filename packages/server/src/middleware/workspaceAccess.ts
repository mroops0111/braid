import type { WorkspaceService } from '@braidhq/core'
import type { Context, MiddlewareHandler } from 'hono'
import type { WorkspaceRegistryFile } from '../infrastructure/fs/WorkspaceRegistryFile.js'
import type { UserRegistryFile } from '../infrastructure/users/UserRegistryFile.js'
import type { Capability, ViewerContext } from '../policy/index.js'
import { ForbiddenError } from '@braidhq/core'
import { defaultPermissionRegistry, resolveViewer } from '../policy/index.js'
import { getUserId } from './auth.js'
import { getWorkspaceId } from './workspaceId.js'

/**
 * Server-scope capability guard for actions without a workspace context,
 * such as workspace creation.
 * Builds a viewer with an absent member,
 * so non-admin users resolve to a null effectiveRole,
 * and fail every check by construction.
 *
 * Skips the gate when userRegistry is absent,
 * so in-memory test compositions stay open.
 * Production deployments always pass it.
 */
export function requireServerCapability(
  capability: Capability,
  userRegistry: UserRegistryFile | undefined,
): MiddlewareHandler {
  return async (context, next) => {
    if (!userRegistry) {
      await next()
      return undefined
    }
    const userId = getUserId(context)
    const user = await userRegistry.get(userId)
    if (!user)
      return forbid(`Unknown user "${userId}".`)
    const viewer = resolveViewer(user, undefined)
    if (!defaultPermissionRegistry.can(capability, viewer))
      return forbid(`Your role cannot perform "${capability}".`)
    await next()
    return undefined
  }
}

declare module 'hono' {
  interface ContextVariableMap {
    viewerContext: ViewerContext
  }
}

export interface WorkspaceAccessOptions {
  readonly registry: WorkspaceRegistryFile
  readonly workspaceService: WorkspaceService
  readonly userRegistry: UserRegistryFile
}

/**
 * Resolves the caller's ViewerContext for this workspace,
 * and stashes it on the Hono context for every downstream layer to read.
 * Composes after `workspaceIdMiddleware` and `authMiddleware`.
 * Outsiders get 403 here, meaning no member row and not a server admin.
 *
 * The actual policy decisions live in `policy/`.
 * This middleware only builds the viewer,
 * and rejects unauthenticated outsiders.
 */
export function workspaceAccessMiddleware(options: WorkspaceAccessOptions): MiddlewareHandler {
  return async (context, next) => {
    const workspaceId = getWorkspaceId(context)
    const userId = getUserId(context)
    const user = await options.userRegistry.get(userId)
    if (!user)
      return forbid(`Unknown user "${userId}".`)
    const workspace = await options.workspaceService.findById(workspaceId)
    const member = await options.registry.getMember(workspace.rootPath, userId)
    const viewer = resolveViewer(user, member)
    if (viewer.effectiveRole === null)
      return forbid(`You are not a member of workspace "${workspaceId}".`)
    context.set('viewerContext', viewer)
    await next()
    return undefined
  }
}

export function getViewerContext(context: Context): ViewerContext | undefined {
  return context.get('viewerContext')
}

/**
 * Mutation guard.
 * Returns 403 when the viewer cannot perform the given capability.
 * Optional `buildResource` lets a capability such as `skill.run`
 * attach per-request data the check needs.
 *
 * Compositions that don't mount `workspaceAccessMiddleware`,
 * such as in-memory tests or the headless server, skip the gate.
 * Production deployments always mount it, so the gate is real.
 */
export function requirePermission(
  capability: Capability,
  buildResource?: (context: Context) => Promise<ViewerContext['resource']>,
): MiddlewareHandler {
  return async (context, next) => {
    const base = getViewerContext(context)
    if (!base) {
      await next()
      return undefined
    }
    const resource = buildResource ? await buildResource(context) : undefined
    const viewer: ViewerContext = resource ? { ...base, resource } : base
    if (!defaultPermissionRegistry.can(capability, viewer))
      return forbid(`Your role cannot perform "${capability}".`)
    await next()
    return undefined
  }
}

function forbid(detail: string): never {
  throw new ForbiddenError(detail)
}
