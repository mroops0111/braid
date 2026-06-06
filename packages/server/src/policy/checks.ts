import type { CapabilityCheck } from './CapabilityCheck.js'

/**
 * First-party capability checks, mirrored byte-equivalent in
 * `packages/studio/src/policy/checks.ts`. The server is the
 * authoritative gate; the client copy lets Studio render Locked-style
 * affordances without hitting a 403.
 *
 * Workspace-scope verbs collapse to `read` + `write` per resource.
 * Workspace.create is server-scope (resolveViewer with no member).
 * Skill.run keeps its own verb because its three-step resolution
 * (owner short-circuit, per-member override, manifest allowedRoles)
 * doesn't fit a read/write pair.
 */
export const checks: readonly CapabilityCheck[] = [
  { id: 'workspace.create', evaluate: v => v.effectiveRole === 'owner' },
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
    id: 'clarify.read',
    evaluate: v => v.effectiveRole === 'owner' || v.effectiveRole === 'maintainer',
  },
  {
    id: 'clarify.write',
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
