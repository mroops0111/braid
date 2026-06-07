import type { WorkspaceMember } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { asUser, asUserJson, buildMultiUserApp } from '../helpers/multiUser.js'
import { readJson } from '../helpers/readJson.js'

interface MembersListBody {
  items: readonly WorkspaceMember[]
}

describe('GET /workspaces/:ws/members', () => {
  it('returns the seeded members to any current member', async () => {
    const { app, workspaceId, users } = await buildMultiUserApp()

    const response = await app.request(
      `/workspaces/${workspaceId}/members`,
      asUser(users.maintainer.id),
    )

    expect(response.status).toBe(200)
    const body = await readJson<MembersListBody>(response)
    expect(body.items.map(m => m.userId).sort()).toEqual([
      users.guest.id,
      users.maintainer.id,
      users.owner.id,
    ])
  })

  it('rejects callers who are not members of the workspace', async () => {
    const { app, workspaceId, users } = await buildMultiUserApp()

    const response = await app.request(
      `/workspaces/${workspaceId}/members`,
      asUser(users.outsider.id),
    )

    expect(response.status).toBe(403)
  })
})

describe('POST /workspaces/:ws/members', () => {
  it('lets the owner add a guest member by userId', async () => {
    const { app, workspaceId, users } = await buildMultiUserApp({ members: { maintainer: false, guest: false } })

    const response = await app.request(
      `/workspaces/${workspaceId}/members`,
      asUserJson(users.owner.id, 'POST', { userId: users.guest.id }),
    )

    expect(response.status).toBe(201)
    const added = await response.json() as WorkspaceMember
    expect(added.userId).toBe(users.guest.id)
    expect(added.role).toBe('guest')

    const list = await readJson<MembersListBody>(
      await app.request(`/workspaces/${workspaceId}/members`, asUser(users.owner.id)),
    )
    expect(list.items.map(m => m.userId)).toContain(users.guest.id)
  })

  it('forbids maintainers from adding members', async () => {
    const { app, workspaceId, users } = await buildMultiUserApp()

    const response = await app.request(
      `/workspaces/${workspaceId}/members`,
      asUserJson(users.maintainer.id, 'POST', { userId: users.outsider.id, role: 'maintainer' }),
    )

    expect(response.status).toBe(403)
  })

  it('forbids guests from adding members', async () => {
    const { app, workspaceId, users } = await buildMultiUserApp()

    const response = await app.request(
      `/workspaces/${workspaceId}/members`,
      asUserJson(users.guest.id, 'POST', { userId: users.outsider.id }),
    )

    expect(response.status).toBe(403)
  })
})

describe('PATCH /workspaces/:ws/members/:userId', () => {
  it('lets the owner promote a guest to maintainer', async () => {
    const { app, workspaceId, users } = await buildMultiUserApp()

    const response = await app.request(
      `/workspaces/${workspaceId}/members/${users.guest.id}`,
      asUserJson(users.owner.id, 'PATCH', { role: 'maintainer' }),
    )

    expect(response.status).toBe(200)
    const updated = await response.json() as WorkspaceMember
    expect(updated.role).toBe('maintainer')
  })

  it('lets the owner set per-skill overrides on a member', async () => {
    const { app, workspaceId, users } = await buildMultiUserApp()

    const response = await app.request(
      `/workspaces/${workspaceId}/members/${users.guest.id}`,
      asUserJson(users.owner.id, 'PATCH', { skillOverrides: { 'braid-ask': 'allow' } }),
    )

    expect(response.status).toBe(200)
    const updated = await response.json() as WorkspaceMember
    expect(updated.skillOverrides).toEqual({ 'braid-ask': 'allow' })
  })

  it('forbids maintainers from changing roles', async () => {
    const { app, workspaceId, users } = await buildMultiUserApp()

    const response = await app.request(
      `/workspaces/${workspaceId}/members/${users.guest.id}`,
      asUserJson(users.maintainer.id, 'PATCH', { role: 'maintainer' }),
    )

    expect(response.status).toBe(403)
  })
})

describe('DELETE /workspaces/:ws/members/:userId', () => {
  it('lets the owner remove a guest', async () => {
    const { app, workspaceId, users } = await buildMultiUserApp()

    const response = await app.request(
      `/workspaces/${workspaceId}/members/${users.guest.id}`,
      asUserJson(users.owner.id, 'DELETE'),
    )

    expect(response.status).toBe(204)
    const list = await readJson<MembersListBody>(
      await app.request(`/workspaces/${workspaceId}/members`, asUser(users.owner.id)),
    )
    expect(list.items.map(m => m.userId)).not.toContain(users.guest.id)
  })

  it('returns 404 when the userId is not a member', async () => {
    const { app, workspaceId, users } = await buildMultiUserApp()

    const response = await app.request(
      `/workspaces/${workspaceId}/members/${users.outsider.id}`,
      asUserJson(users.owner.id, 'DELETE'),
    )

    expect(response.status).toBe(404)
  })

  it('forbids maintainers from removing other members', async () => {
    const { app, workspaceId, users } = await buildMultiUserApp()

    const response = await app.request(
      `/workspaces/${workspaceId}/members/${users.guest.id}`,
      asUserJson(users.maintainer.id, 'DELETE'),
    )

    expect(response.status).toBe(403)
  })
})

describe('POST /workspaces/:ws/transfer-ownership', () => {
  it('demotes the current owner to maintainer and promotes the target', async () => {
    const { app, workspaceId, users } = await buildMultiUserApp()

    const response = await app.request(
      `/workspaces/${workspaceId}/transfer-ownership`,
      asUserJson(users.owner.id, 'POST', { newOwnerId: users.maintainer.id }),
    )

    expect(response.status).toBe(200)
    const body = await readJson<MembersListBody>(response)
    const owner = body.items.find(m => m.role === 'owner')
    expect(owner?.userId).toBe(users.maintainer.id)
    const previousOwner = body.items.find(m => m.userId === users.owner.id)
    expect(previousOwner?.role).toBe('maintainer')
    expect(body.items.filter(m => m.role === 'owner')).toHaveLength(1)
  })

  it('is idempotent when the target is already the owner', async () => {
    const { app, workspaceId, users } = await buildMultiUserApp()

    const response = await app.request(
      `/workspaces/${workspaceId}/transfer-ownership`,
      asUserJson(users.owner.id, 'POST', { newOwnerId: users.owner.id }),
    )

    expect(response.status).toBe(200)
    const body = await readJson<MembersListBody>(response)
    expect(body.items.find(m => m.userId === users.owner.id)?.role).toBe('owner')
    expect(body.items.filter(m => m.role === 'owner')).toHaveLength(1)
  })

  it('returns 404 when the target user is not a workspace member', async () => {
    const { app, workspaceId, users } = await buildMultiUserApp()

    const response = await app.request(
      `/workspaces/${workspaceId}/transfer-ownership`,
      asUserJson(users.owner.id, 'POST', { newOwnerId: users.outsider.id }),
    )

    expect(response.status).toBe(404)
  })

  it('forbids maintainers from transferring ownership', async () => {
    const { app, workspaceId, users } = await buildMultiUserApp()

    const response = await app.request(
      `/workspaces/${workspaceId}/transfer-ownership`,
      asUserJson(users.maintainer.id, 'POST', { newOwnerId: users.maintainer.id }),
    )

    expect(response.status).toBe(403)
  })
})
