import type { User } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { asUser, asUserJson, buildMultiUserApp } from '../helpers/multiUser.js'
import { readJson } from '../helpers/readJson.js'

interface InviteListBody {
  items: ReadonlyArray<{ email: string, serverRole?: string }>
}

interface AdminUserListBody {
  items: ReadonlyArray<User & {
    workspaces: ReadonlyArray<{ workspaceId: string, role: string }>
  }>
}

describe('admin routes (server.admin gate)', () => {
  it('returns 403 to non-admin callers across every endpoint', async () => {
    const { app, users } = await buildMultiUserApp()
    const owner = users.owner.id

    const list = await app.request('/admin/invites', asUser(owner))
    expect(list.status).toBe(403)

    const create = await app.request(
      '/admin/invites',
      asUserJson(owner, 'POST', { email: 'invitee@example.com' }),
    )
    expect(create.status).toBe(403)

    const listUsers = await app.request('/admin/users', asUser(owner))
    expect(listUsers.status).toBe(403)
  })
})

describe('POST /admin/invites + GET /admin/invites + DELETE /admin/invites/:email', () => {
  it('admin can invite, list, and revoke an email round-trip', async () => {
    const { app, users } = await buildMultiUserApp()
    const admin = users.admin.id

    const created = await app.request(
      '/admin/invites',
      asUserJson(admin, 'POST', { email: 'invitee@example.com' }),
    )
    expect(created.status).toBe(201)

    const listed = await readJson<InviteListBody>(
      await app.request('/admin/invites', asUser(admin)),
    )
    expect(listed.items.map(i => i.email)).toContain('invitee@example.com')

    const revoked = await app.request(
      '/admin/invites/invitee%40example.com',
      asUserJson(admin, 'DELETE'),
    )
    expect(revoked.status).toBe(204)

    const reList = await readJson<InviteListBody>(
      await app.request('/admin/invites', asUser(admin)),
    )
    expect(reList.items.map(i => i.email)).not.toContain('invitee@example.com')
  })

  it('revoking a never-existed invite returns 204 (idempotent)', async () => {
    const { app, users } = await buildMultiUserApp()
    const admin = users.admin.id

    const response = await app.request(
      '/admin/invites/nobody%40example.com',
      asUserJson(admin, 'DELETE'),
    )

    expect(response.status).toBe(204)
  })

  it('rejects a malformed email body with 400', async () => {
    const { app, users } = await buildMultiUserApp()
    const admin = users.admin.id

    const response = await app.request(
      '/admin/invites',
      asUserJson(admin, 'POST', { email: 'not-an-email' }),
    )

    expect(response.status).toBe(400)
  })
})

describe('GET /admin/users', () => {
  it('lists every user with their workspace memberships flattened in', async () => {
    const { app, workspaceId, users } = await buildMultiUserApp()

    const response = await app.request('/admin/users', asUser(users.admin.id))

    expect(response.status).toBe(200)
    const body = await readJson<AdminUserListBody>(response)
    const ids = body.items.map(u => u.id)
    expect(ids).toContain(users.owner.id)
    expect(ids).toContain(users.maintainer.id)
    expect(ids).toContain(users.guest.id)
    expect(ids).toContain(users.outsider.id)

    const ownerRow = body.items.find(u => u.id === users.owner.id)
    expect(ownerRow?.workspaces).toEqual([{ workspaceId, role: 'owner' }])
    const outsiderRow = body.items.find(u => u.id === users.outsider.id)
    expect(outsiderRow?.workspaces).toEqual([])
  })
})

describe('PATCH /admin/users/:userId', () => {
  it('admin can promote a user to admin server-role', async () => {
    const { app, users } = await buildMultiUserApp()

    const response = await app.request(
      `/admin/users/${users.maintainer.id}`,
      asUserJson(users.admin.id, 'PATCH', { serverRole: 'admin' }),
    )

    expect(response.status).toBe(200)
    const updated = await response.json() as User
    expect(updated.serverRole).toBe('admin')
  })

  it('returns 404 when the target userId does not exist', async () => {
    const { app, users } = await buildMultiUserApp()

    const response = await app.request(
      '/admin/users/usr-ghost',
      asUserJson(users.admin.id, 'PATCH', { serverRole: 'user' }),
    )

    expect(response.status).toBe(404)
  })
})

describe('DELETE /admin/users/:userId', () => {
  it('admin can remove a non-self user', async () => {
    const { app, users } = await buildMultiUserApp()

    const response = await app.request(
      `/admin/users/${users.outsider.id}`,
      asUserJson(users.admin.id, 'DELETE'),
    )

    expect(response.status).toBe(204)

    const listed = await readJson<AdminUserListBody>(
      await app.request('/admin/users', asUser(users.admin.id)),
    )
    expect(listed.items.map(u => u.id)).not.toContain(users.outsider.id)
  })

  it('refuses self-delete to avoid locking the single admin out', async () => {
    const { app, users } = await buildMultiUserApp()

    const response = await app.request(
      `/admin/users/${users.admin.id}`,
      asUserJson(users.admin.id, 'DELETE'),
    )

    expect(response.status).toBe(400)
  })
})
