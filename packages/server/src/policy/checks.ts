import type { CapabilityCheck } from './CapabilityCheck.js'

/**
 * First-party capability checks,
 * mirrored byte-equivalent in `packages/studio/src/policy/checks.ts`.
 * The server is the authoritative gate.
 * The client copy lets Studio render locked affordances, without hitting a 403.
 *
 * Workspace-scope verbs collapse to read and write per resource.
 * `workspace.create` is server-scope, resolved with no member.
 * `skill.run` keeps its own verb for its three-step resolution,
 * covering owner short-circuit, per-member override, allowedRoles,
 * which does not fit a read or write pair.
 */
export const checks: readonly CapabilityCheck[] = [
  { id: 'workspace.create', evaluate: v => v.effectiveRole === 'owner' },
  // Server admin reads serverRole directly, not effectiveRole,
  // since a workspace owner also resolves to an owner effectiveRole.
  { id: 'server.admin', evaluate: v => v.user.serverRole === 'admin' },
  { id: 'workspace.read', evaluate: v => v.effectiveRole !== null },
  { id: 'workspace.write', evaluate: v => v.effectiveRole === 'owner' },
  {
    id: 'proposal.read',
    evaluate: v => v.effectiveRole === 'owner' || v.effectiveRole === 'maintainer',
  },
  {
    id: 'proposal.write',
    evaluate: v => v.effectiveRole === 'owner' || v.effectiveRole === 'maintainer',
  },
  {
    id: 'clarification.read',
    evaluate: v => v.effectiveRole === 'owner' || v.effectiveRole === 'maintainer',
  },
  {
    id: 'clarification.write',
    evaluate: v => v.effectiveRole === 'owner' || v.effectiveRole === 'maintainer',
  },
  { id: 'history.write', evaluate: v => v.effectiveRole === 'owner' },
  {
    id: 'skill.run',
    evaluate: (v) => {
      const skill = v.resource?.skill
      const skillId = v.resource?.skillId
      if (!skill || !skillId)
        return false
      if (v.effectiveRole === null)
        return false
      if (v.effectiveRole === 'owner')
        return true
      const override = v.member?.skillOverrides?.[skillId as keyof typeof v.member.skillOverrides]
      if (override)
        return override === 'allow'
      return skill.braid.allowedRoles.includes(v.effectiveRole)
    },
  },
]
