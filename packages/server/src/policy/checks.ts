import type { CapabilityCheck } from './CapabilityCheck.js'

/**
 * First-party capability checks,
 * mirrored byte-equivalent in `packages/studio/src/policy/checks.ts`.
 * The server is the authoritative gate.
 * The client copy lets Studio render locked affordances, without hitting a 403.
 *
 * Server-scope checks read `serverRole` rather than `effectiveRole`,
 * since they resolve with no member and a workspace owner is an owner too.
 *
 * A resource every member may read has no check here at all.
 * `workspaceAccessMiddleware` already refused everybody else,
 * so a check that only repeats it would never decide anything.
 *
 * `skill.run` keeps its own verb for its three-step resolution,
 * covering owner short-circuit, per-member override, allowedRoles,
 * which does not fit a read or write pair.
 */
export const checks: readonly CapabilityCheck[] = [
  { id: 'server.write', evaluate: v => v.user.serverRole === 'admin' },
  { id: 'server.manage', evaluate: v => v.user.serverRole === 'admin' },
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
