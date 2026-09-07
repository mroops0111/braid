import type { AbsolutePath, Timestamp, UserId, Workspace, WorkspaceMember } from '@braidhq/schema'
import type { WorkspaceRegistryFile } from '../../../src/infrastructure/workspace/WorkspaceRegistryFile.js'
import { describe, expect, it } from 'vitest'
import {
  autoJoinExistingUsers,
  autoJoinOpenWorkspaces,
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

function workspace(rootPath: string, autoJoinAs?: 'guest'): Workspace {
  return {
    id: rootPath as Workspace['id'],
    rootPath: rootPath as AbsolutePath,
    productManifest: { ...(autoJoinAs ? { autoJoinAs } : {}) } as Workspace['productManifest'],
  }
}

describe('autoJoinOpenWorkspaces', () => {
  const ada = { id: 'user-ada' as UserId }

  it('joins the workspaces that admit arrivals, and no others', async () => {
    const registry = fakeRegistry()
    await autoJoinOpenWorkspaces(deps(registry), ada, [
      workspace('/open', 'guest'),
      workspace('/closed'),
      workspace('/also-open', 'guest'),
    ])
    expect(registry.added.map(entry => entry.rootPath)).toEqual(['/open', '/also-open'])
  })

  // Signing in must not hand out write access,
  // so the automatic path has one role and no way to ask for another.
  it('joins as guest even where the workspace has no other members', async () => {
    const registry = fakeRegistry()
    await autoJoinOpenWorkspaces(deps(registry), ada, [workspace('/open', 'guest')])
    expect(registry.added[0]!.member.role).toBe('guest')
  })

  // Absent is the default, and a workspace that never spoke admits nobody.
  it('admits nobody where no workspace says otherwise', async () => {
    const registry = fakeRegistry()
    await autoJoinOpenWorkspaces(deps(registry), ada, [workspace('/a'), workspace('/b')])
    expect(registry.added).toEqual([])
  })

  it('leaves an existing membership alone rather than adding a second', async () => {
    const registry = fakeRegistry({
      '/open': [{ userId: ada.id, role: 'owner', joinedAt: NOW }],
    })
    await autoJoinOpenWorkspaces(deps(registry), ada, [workspace('/open', 'guest')])
    expect(registry.added).toEqual([])
  })

  // The reactor is a component of the deployment rather than a colleague,
  // and it reaches a workspace through its own token.
  it('passes over a service account', async () => {
    const registry = fakeRegistry()
    const reactor = { id: 'reactor' as UserId, kind: 'service' as const }
    await autoJoinOpenWorkspaces(deps(registry), reactor, [workspace('/open', 'guest')])
    expect(registry.added).toEqual([])
  })
})

describe('autoJoinExistingUsers', () => {
  const users = [
    { id: 'user-ada' as UserId },
    { id: 'user-bo' as UserId },
    { id: 'reactor' as UserId, kind: 'service' as const },
  ]

  it('backfills everyone registered when a workspace starts admitting', async () => {
    const registry = fakeRegistry()
    await autoJoinExistingUsers(deps(registry), '/open' as AbsolutePath, 'guest', users)
    expect(registry.added.map(entry => entry.member.userId)).toEqual(['user-ada', 'user-bo'])
  })

  // Closing a workspace is the common edit,
  // and it must never read as an instruction to add everybody.
  it('adds nobody when the workspace admits nobody', async () => {
    const registry = fakeRegistry()
    await autoJoinExistingUsers(deps(registry), '/open' as AbsolutePath, undefined, users)
    expect(registry.added).toEqual([])
  })

  it('does not disturb a user who is already a member', async () => {
    const registry = fakeRegistry({
      '/open': [{ userId: 'user-ada' as UserId, role: 'maintainer', joinedAt: NOW }],
    })
    await autoJoinExistingUsers(deps(registry), '/open' as AbsolutePath, 'guest', users)
    expect(registry.added.map(entry => entry.member.userId)).toEqual(['user-bo'])
  })
})
