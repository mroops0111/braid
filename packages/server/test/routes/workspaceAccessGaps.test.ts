import { describe, expect, it } from 'vitest'
import { asUser, buildMultiUserApp } from '../helpers/multiUser.js'

// Hono runs matched handlers in registration order,
// so a route on the bare `/workspaces` router answers first,
// ahead of the scoped sub-app that carries the membership gate.
// Both paths below look scoped, and each needs that gate applied directly.

describe('GET /workspaces/:ws', () => {
  it('returns the workspace to a member', async () => {
    const { app, workspaceId, users } = await buildMultiUserApp()

    const response = await app.request(`/workspaces/${workspaceId}`, asUser(users.guest.id))

    expect(response.status).toBe(200)
  })

  it('rejects a caller who is not a member', async () => {
    const { app, workspaceId, users } = await buildMultiUserApp()

    const response = await app.request(`/workspaces/${workspaceId}`, asUser(users.outsider.id))

    expect(response.status).toBe(403)
  })
})

describe('GET /workspaces/:ws/events', () => {
  it('rejects a caller who is not a member', async () => {
    const { app, workspaceId, users } = await buildMultiUserApp()

    const response = await app.request(`/workspaces/${workspaceId}/events`, asUser(users.outsider.id))

    expect(response.status).toBe(403)
  })
})
