import type { SkillRegistry, WorkspaceRepository } from '@braidhq/core'
import type { SkillFrontmatter, SkillId, WorkspaceMember, WorkspaceRole } from '@braidhq/schema'
import type { MiddlewareHandler } from 'hono'
import { loadWorkspaceById } from '../routes/helpers.js'
import { getWorkspaceMember, getWorkspaceRole } from './workspaceAccess.js'
import { getWorkspaceId } from './workspaceId.js'

/**
 * Resolution order:
 *   1. Owner role always allowed (protects against a manifest that
 *      omits 'owner' from allowedRoles by mistake).
 *   2. Explicit per-member override wins next.
 *   3. Otherwise fall back to the skill manifest's allowedRoles list.
 *
 * `member` is undefined for the server-admin bypass path; admins land
 * here with a virtual 'owner' role from workspaceAccessMiddleware, so
 * rule 1 catches them and they don't need a skillOverrides lookup.
 */
export function effectiveSkillPermission(
  skill: SkillFrontmatter,
  role: WorkspaceRole,
  member: WorkspaceMember | undefined,
  skillId: string,
): 'allow' | 'deny' {
  if (role === 'owner')
    return 'allow'
  const override = member?.skillOverrides?.[skillId as keyof typeof member.skillOverrides]
  if (override)
    return override
  return skill.braid.allowedRoles.includes(role) ? 'allow' : 'deny'
}

export interface RequireSkillPermissionDeps {
  readonly skillRegistry: SkillRegistry
  readonly workspaceRepository: WorkspaceRepository
}

/**
 * Workspace-scoped middleware. Composes after workspaceAccessMiddleware
 * so the caller's role + member record are already on the context.
 * Reads the skillId from the path param. When workspaceRole is unset
 * (e.g. tests using composeApp without the access middleware) the gate
 * is a no-op so the existing test fixtures stay green.
 */
export function requireSkillPermission(deps: RequireSkillPermissionDeps): MiddlewareHandler {
  return async (context, next) => {
    const role = getWorkspaceRole(context) as WorkspaceRole | undefined
    if (!role) {
      await next()
      return undefined
    }
    const skillId = context.req.param('skillId') as SkillId | undefined
    if (!skillId) {
      await next()
      return undefined
    }
    const workspace = await loadWorkspaceById(getWorkspaceId(context), deps.workspaceRepository)
    const manifest = await deps.skillRegistry.get(workspace, skillId)
    const member = getWorkspaceMember(context)
    const permission = effectiveSkillPermission(
      manifest.toData().frontmatter,
      role,
      member,
      skillId,
    )
    if (permission === 'deny') {
      return context.json(
        {
          type: 'about:blank',
          title: 'Forbidden',
          status: 403,
          detail: `Your role ("${role}") cannot run skill "${skillId}".`,
        },
        403,
        { 'Content-Type': 'application/problem+json' },
      )
    }
    await next()
    return undefined
  }
}
