import type { SkillManifest, User, WorkspaceMember, WorkspaceRole } from '@braidhq/schema'

/**
 * Mirrors `effectiveSkillPermission` in packages/server/src/middleware/
 * skillPermission.ts. Keep the two in sync; the server is the
 * authoritative gate, this is the optimistic client preview so users
 * see "Locked" without hitting the 403.
 */
export function canRunSkill(
  skill: SkillManifest,
  role: WorkspaceRole | undefined,
  member: WorkspaceMember | undefined,
): boolean {
  if (!role)
    return true
  if (role === 'owner')
    return true
  const override = member?.skillOverrides?.[skill.id]
  if (override)
    return override === 'allow'
  return skill.frontmatter.braid.allowedRoles.includes(role)
}

/**
 * Resolve the viewer's effective workspace role + member entry from the
 * existing /users/me and /workspaces/:id/members reads. Server admins
 * get a virtual `owner` role with no member entry, matching
 * workspaceAccessMiddleware's bypass path.
 */
export function resolveMyMembership(
  me: User | undefined,
  members: readonly WorkspaceMember[] | undefined,
): { role: WorkspaceRole | undefined, member: WorkspaceMember | undefined } {
  if (!me || !members)
    return { role: undefined, member: undefined }
  const member = members.find(m => m.userId === me.id)
  if (member)
    return { role: member.role, member }
  if (me.serverRole === 'admin')
    return { role: 'owner', member: undefined }
  return { role: undefined, member: undefined }
}
