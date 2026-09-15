import type { CapabilityCheck } from './CapabilityCheck'

/**
 * All first-party capability checks in one file.
 * Studio does not need the per-file class spread,
 * that the server uses for test scope,
 * the logic is small enough to read top-to-bottom here.
 *
 * Keep these byte-equivalent with the server-side checks,
 * under packages/server/src/policy/checks.ts.
 * If they diverge, the optimistic UI will lie,
 * about what the server will allow.
 */
export const checks: readonly CapabilityCheck[] = [
  // Server scope, read off serverRole, since these resolve with no member
  // and a workspace owner resolves to an owner effectiveRole too.
  { id: 'server.write', evaluate: v => v.user.serverRole === 'admin' },
  { id: 'server.manage', evaluate: v => v.user.serverRole === 'admin' },
  // Workspace scope. Anything every member may read has no check,
  // because membership alone already decided it.
  {
    id: 'handoff.read',
    evaluate: v => v.effectiveRole === 'owner' || v.effectiveRole === 'maintainer',
  },
  {
    id: 'handoff.write',
    evaluate: v => v.effectiveRole === 'owner' || v.effectiveRole === 'maintainer',
  },
  { id: 'workspace.write', evaluate: v => v.effectiveRole === 'owner' },
  { id: 'workspace.manage', evaluate: v => v.effectiveRole === 'owner' },
  { id: 'history.write', evaluate: v => v.effectiveRole === 'owner' },
  {
    id: 'run.share',
    // Authorship, not role.
    // An owner reads every run already,
    // but letting them hand someone else's conversation to a third party,
    // would make a run readable without its author ever acting,
    // so the grant stays with whoever opened it.
    evaluate: v => v.resource?.sessionStartedBy !== undefined
      && v.resource.sessionStartedBy === v.user.id,
  },
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
