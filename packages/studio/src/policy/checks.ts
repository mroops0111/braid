import type { CapabilityCheck } from './CapabilityCheck'

/**
 * All first-party capability checks in one file.
 * Studio does not need the per-file class spread,
 * that the server uses for test scope,
 * the logic is small enough to read top-to-bottom here.
 *
 * Keep these byte-equivalent with the server-side checks,
 * under packages/server/src/policy/checks/.
 * If they diverge, the optimistic UI will lie,
 * about what the server will allow.
 */
export const checks: readonly CapabilityCheck[] = [
  // Server-scope. Evaluated with member=undefined,
  // so only admins resolve to effectiveRole='owner' under that path.
  { id: 'workspace.create', evaluate: v => v.effectiveRole === 'owner' },
  // Server admin reads serverRole directly, not effectiveRole,
  // since a workspace owner also resolves to an owner effectiveRole.
  { id: 'server.admin', evaluate: v => v.user.serverRole === 'admin' },
  // Workspace-scope read/write pairs.
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
