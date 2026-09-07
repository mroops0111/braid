import type { AbsolutePath, Timestamp, UserId, Workspace, WorkspaceMember } from '@braidhq/schema'
import type { WorkspaceRegistryFile } from '../../../src/infrastructure/workspace/WorkspaceRegistryFile.js'
import { describe, expect, it } from 'vitest'
import {
  autoJoinExistingUsers,
  autoJoinOpenWorkspaces,
  domainIsOpen,
} from '../../../src/infrastructure/users/autoJoinGuests.js'

const NOW = '2026-01-01T00:00:00.000Z' as Timestamp

function fakeRegistry(seed: Record<string, WorkspaceMember[]> = {}) {
  const members = new Map<string, WorkspaceMember[]>(Object.entries(seed))
  return {
    added: [] as Array<{ rootPath: string, member: WorkspaceMember }>,
    async getMember(rootPath: AbsolutePath, userId: UserId) {
      return (members.get(rootPath) ?? []).find(member => member.userId === userId)
    },
    async addMember(rootPath: AbsolutePath, member: WorkspaceMember) {
      members.set(rootPath, [...(members.get(rootPath) ?? []), member])
      this.added.push({ rootPath, member })
    },
  }
}

function deps(registry: ReturnType<typeof fakeRegistry>) {
  return { registry: registry as unknown as WorkspaceRegistryFile, now: () => NOW }
}

function workspace(rootPath: string, openToDomains: string[]): Workspace {
  return {
    id: rootPath as Workspace['id'],
    rootPath: rootPath as AbsolutePath,
    productManifest: { openToDomains } as Workspace['productManifest'],
  }
}

describe('domainIsOpen', () => {
  it('matches the domain whatever case either side was written in', () => {
    expect(domainIsOpen('Ada@Kdan.com', ['kdan.com'])).toBe(true)
    expect(domainIsOpen('ada@kdan.com', ['KDAN.COM'])).toBe(true)
  })

  // A subdomain is a different organisation as often as it is the same one,
  // so it has to be named rather than inferred.
  it('does not treat a subdomain as the domain it sits under', () => {
    expect(domainIsOpen('ada@mail.kdan.com', ['kdan.com'])).toBe(false)
  })

  it('matches nothing when the address carries no domain', () => {
    expect(domainIsOpen('ada', ['kdan.com'])).toBe(false)
    expect(domainIsOpen('ada@', ['kdan.com'])).toBe(false)
  })

  // An address may legitimately hold more than one `@`, and the domain is
  // what follows the last of them.
  it('reads the domain from the last at sign', () => {
    expect(domainIsOpen('"a@b"@kdan.com', ['kdan.com'])).toBe(true)
  })

  it('opens to nobody by default', () => {
    expect(domainIsOpen('ada@kdan.com', [])).toBe(false)
  })
})

describe('autoJoinOpenWorkspaces', () => {
  const ada = { id: 'user-ada' as UserId, email: 'ada@kdan.com' }

  it('joins every workspace open to the domain, and no others', async () => {
    const registry = fakeRegistry()
    await autoJoinOpenWorkspaces(deps(registry), ada, [
      workspace('/open', ['kdan.com']),
      workspace('/closed', []),
      workspace('/other', ['example.com']),
    ])
    expect(registry.added.map(entry => entry.rootPath)).toEqual(['/open'])
    expect(registry.added[0]!.member.role).toBe('guest')
  })

  // Signing in must not hand out write access, so the automatic path has one
  // role and no way to ask for another.
  it('joins as guest even where the workspace has no other members', async () => {
    const registry = fakeRegistry()
    await autoJoinOpenWorkspaces(deps(registry), ada, [workspace('/open', ['kdan.com'])])
    expect(registry.added[0]!.member.role).toBe('guest')
  })

  it('leaves an existing membership alone rather than adding a second', async () => {
    const registry = fakeRegistry({
      '/open': [{ userId: ada.id, role: 'owner', joinedAt: NOW }],
    })
    await autoJoinOpenWorkspaces(deps(registry), ada, [workspace('/open', ['kdan.com'])])
    expect(registry.added).toEqual([])
  })
})

describe('autoJoinExistingUsers', () => {
  const users = [
    { id: 'user-ada' as UserId, email: 'ada@kdan.com' },
    { id: 'user-bo' as UserId, email: 'bo@example.com' },
    { id: 'user-cy' as UserId, email: 'cy@kdan.com' },
  ]

  it('backfills only the users whose domain the workspace opened to', async () => {
    const registry = fakeRegistry()
    await autoJoinExistingUsers(deps(registry), '/open' as AbsolutePath, ['kdan.com'], users)
    expect(registry.added.map(entry => entry.member.userId)).toEqual(['user-ada', 'user-cy'])
  })

  // Closing a workspace is the common edit, and it must not read as an
  // instruction to add everybody.
  it('adds nobody when the workspace opens to no domain', async () => {
    const registry = fakeRegistry()
    await autoJoinExistingUsers(deps(registry), '/open' as AbsolutePath, [], users)
    expect(registry.added).toEqual([])
  })

  it('does not disturb a user who is already a member', async () => {
    const registry = fakeRegistry({
      '/open': [{ userId: 'user-ada' as UserId, role: 'maintainer', joinedAt: NOW }],
    })
    await autoJoinExistingUsers(deps(registry), '/open' as AbsolutePath, ['kdan.com'], users)
    expect(registry.added.map(entry => entry.member.userId)).toEqual(['user-cy'])
  })
})
