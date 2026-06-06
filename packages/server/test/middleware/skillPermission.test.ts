import type { SkillFrontmatter, SkillId, Timestamp, UserId, WorkspaceMember, WorkspaceRole } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { effectiveSkillPermission } from '../../src/middleware/skillPermission.js'

function makeManifest(allowedRoles: WorkspaceRole[]): SkillFrontmatter {
  return {
    name: 'braid-test',
    description: 'test skill',
    disableModelInvocation: true,
    braid: {
      requiredEnv: [],
      requiredMcpServers: [],
      allowedRoles,
    },
  } as SkillFrontmatter
}

function makeMember(role: WorkspaceRole, overrides?: WorkspaceMember['skillOverrides']): WorkspaceMember {
  return {
    userId: 'usr-test' as UserId,
    role,
    joinedAt: '2026-01-01T00:00:00.000Z' as Timestamp,
    ...(overrides ? { skillOverrides: overrides } : {}),
  }
}

describe('effectiveSkillPermission', () => {
  const skill = makeManifest(['owner', 'maintainer'])
  const skillId = 'braid-test' as SkillId

  it('owner role short-circuits to allow regardless of allowedRoles', () => {
    const lockedDown = makeManifest(['guest']) // owner deliberately omitted
    const member = makeMember('owner')
    expect(effectiveSkillPermission(lockedDown, 'owner', member, skillId)).toBe('allow')
  })

  it('owner role short-circuits to allow even with explicit deny override', () => {
    // Owners are infrastructure-trusted; an override deny cannot lock them out.
    const member = makeMember('owner', { [skillId]: 'deny' })
    expect(effectiveSkillPermission(skill, 'owner', member, skillId)).toBe('allow')
  })

  it('per-member override allow wins over a role denied by allowedRoles', () => {
    const member = makeMember('guest', { [skillId]: 'allow' })
    expect(effectiveSkillPermission(skill, 'guest', member, skillId)).toBe('allow')
  })

  it('per-member override deny wins over a role allowed by allowedRoles', () => {
    const member = makeMember('maintainer', { [skillId]: 'deny' })
    expect(effectiveSkillPermission(skill, 'maintainer', member, skillId)).toBe('deny')
  })

  it('falls back to allowedRoles when no override is set', () => {
    expect(effectiveSkillPermission(skill, 'maintainer', makeMember('maintainer'), skillId)).toBe('allow')
    expect(effectiveSkillPermission(skill, 'guest', makeMember('guest'), skillId)).toBe('deny')
  })

  it('admin-bypass path (undefined member) still resolves via role', () => {
    // workspaceAccessMiddleware sets workspaceRole=owner for admins but
    // leaves workspaceMember undefined since there's no real member row.
    expect(effectiveSkillPermission(skill, 'owner', undefined, skillId)).toBe('allow')
  })
})
