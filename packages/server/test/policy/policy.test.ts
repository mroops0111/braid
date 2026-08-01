import type {
  SkillFrontmatter,
  SkillId,
  Timestamp,
  User,
  UserId,
  WorkspaceMember,
  WorkspaceRole,
} from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import {
  buildDefaultPermissionRegistry,
  type Capability,
  PermissionRegistry,
  resolveViewer,
} from '../../src/policy/index.js'

function makeUser(serverRole: 'admin' | 'user', id = 'usr-test'): User {
  return {
    id: id as UserId,
    displayName: 'Test',
    serverRole,
    createdAt: '2026-01-01T00:00:00.000Z' as Timestamp,
  }
}

function makeMember(role: WorkspaceRole, overrides?: WorkspaceMember['skillOverrides']): WorkspaceMember {
  return {
    userId: 'usr-test' as UserId,
    role,
    joinedAt: '2026-01-01T00:00:00.000Z' as Timestamp,
    ...(overrides ? { skillOverrides: overrides } : {}),
  }
}

function makeSkillManifest(allowedRoles: WorkspaceRole[]): SkillFrontmatter {
  return {
    name: 'braid-test',
    description: 'test',
    disableModelInvocation: true,
    braid: {
      requiredEnv: [],
      requiredMcpServers: [],
      allowedRoles,
    },
  } as SkillFrontmatter
}

describe('resolveViewer', () => {
  it('promotes server admins to owner regardless of member.role', () => {
    const v = resolveViewer(makeUser('admin'), makeMember('guest'))
    expect(v.effectiveRole).toBe('owner')
    // Stored member is kept for display, but ignored by the role.
    expect(v.member?.role).toBe('guest')
  })

  it('uses member.role for plain users', () => {
    const v = resolveViewer(makeUser('user'), makeMember('maintainer'))
    expect(v.effectiveRole).toBe('maintainer')
  })

  it('returns null role for users without a member entry', () => {
    const v = resolveViewer(makeUser('user'), undefined)
    expect(v.effectiveRole).toBeNull()
  })

  it('preserves member as undefined for admins without an explicit row', () => {
    const v = resolveViewer(makeUser('admin'), undefined)
    expect(v.effectiveRole).toBe('owner')
    expect(v.member).toBeUndefined()
  })
})

describe('PermissionRegistry (default)', () => {
  const registry = buildDefaultPermissionRegistry()

  it('owners get read + write on everything', () => {
    const v = resolveViewer(makeUser('user'), makeMember('owner'))
    const all: Capability[] = ['workspace.read', 'workspace.write', 'proposal.read', 'proposal.write', 'clarification.read', 'clarification.write', 'history.write']
    for (const cap of all)
      expect(registry.can(cap, v)).toBe(true)
  })

  it('maintainers get reads + proposal/clarifications write, no workspace.write or history.write', () => {
    const v = resolveViewer(makeUser('user'), makeMember('maintainer'))
    expect(registry.can('workspace.read', v)).toBe(true)
    expect(registry.can('proposal.read', v)).toBe(true)
    expect(registry.can('proposal.write', v)).toBe(true)
    expect(registry.can('clarification.read', v)).toBe(true)
    expect(registry.can('clarification.write', v)).toBe(true)
    expect(registry.can('workspace.write', v)).toBe(false)
    expect(registry.can('history.write', v)).toBe(false)
  })

  it('guests get workspace.read but no proposal/clarifications access', () => {
    const v = resolveViewer(makeUser('user'), makeMember('guest'))
    expect(registry.can('workspace.read', v)).toBe(true)
    expect(registry.can('proposal.read', v)).toBe(false)
    expect(registry.can('proposal.write', v)).toBe(false)
    expect(registry.can('clarification.read', v)).toBe(false)
    expect(registry.can('clarification.write', v)).toBe(false)
    expect(registry.can('workspace.write', v)).toBe(false)
    expect(registry.can('history.write', v)).toBe(false)
  })

  it('outsiders (no member, not admin) get nothing', () => {
    const v = resolveViewer(makeUser('user'), undefined)
    expect(registry.can('workspace.read', v)).toBe(false)
    expect(registry.can('proposal.write', v)).toBe(false)
  })

  it('admin who joined as guest still gets owner-level permissions', () => {
    const v = resolveViewer(makeUser('admin'), makeMember('guest'))
    expect(registry.can('workspace.write', v)).toBe(true)
    expect(registry.can('proposal.write', v)).toBe(true)
    expect(registry.can('history.write', v)).toBe(true)
  })
})

describe('RunSkillCheck', () => {
  const registry = buildDefaultPermissionRegistry()
  const skillId = 'braid-test' as SkillId
  const skill = makeSkillManifest(['owner', 'maintainer'])

  it('owner short-circuits even when the manifest omits owner', () => {
    const locked = makeSkillManifest(['guest'])
    const v = resolveViewer(makeUser('user'), makeMember('owner'), { skill: locked, skillId })
    expect(registry.can('skill.run', v)).toBe(true)
  })

  it('override allow opens a denied role', () => {
    const v = resolveViewer(
      makeUser('user'),
      makeMember('guest', { [skillId]: 'allow' }),
      { skill, skillId },
    )
    expect(registry.can('skill.run', v)).toBe(true)
  })

  it('override deny closes an allowed role', () => {
    const v = resolveViewer(
      makeUser('user'),
      makeMember('maintainer', { [skillId]: 'deny' }),
      { skill, skillId },
    )
    expect(registry.can('skill.run', v)).toBe(false)
  })

  it('falls back to allowedRoles when no override is set', () => {
    const v1 = resolveViewer(makeUser('user'), makeMember('maintainer'), { skill, skillId })
    const v2 = resolveViewer(makeUser('user'), makeMember('guest'), { skill, skillId })
    expect(registry.can('skill.run', v1)).toBe(true)
    expect(registry.can('skill.run', v2)).toBe(false)
  })

  it('admin-as-guest can still run skills the guest role is denied', () => {
    const v = resolveViewer(makeUser('admin'), makeMember('guest'), { skill, skillId })
    expect(registry.can('skill.run', v)).toBe(true)
  })

  it('denies when resource is missing', () => {
    const v = resolveViewer(makeUser('user'), makeMember('maintainer'))
    expect(registry.can('skill.run', v)).toBe(false)
  })
})

describe('PermissionRegistry', () => {
  it('unknown capability ids default to deny', () => {
    const registry = new PermissionRegistry()
    const v = resolveViewer(makeUser('admin'), undefined)
    // Cast to the closed Capability union so we can test the lookup
    // miss; in real code TypeScript would catch this at compile time.
    expect(registry.can('skill.run' as Capability, v)).toBe(false)
  })

  it('register returns the registry for chaining', () => {
    const r = new PermissionRegistry()
    expect(r.register({ id: 'workspace.read', evaluate: () => true })).toBe(r)
    expect(r.has('workspace.read')).toBe(true)
  })
})
