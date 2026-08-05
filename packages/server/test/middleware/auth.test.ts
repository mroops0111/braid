import type { UserId } from '@braidhq/schema'
import type { ResolvedSession, SessionStore } from '../../src/infrastructure/auth/SessionStore.js'
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { authMiddleware, getUserId } from '../../src/middleware/auth.js'

function fakeSessionStore(byToken: Record<string, UserId>): SessionStore {
  return {
    issue: async () => { throw new Error('not used') },
    resolve: async (token: string): Promise<ResolvedSession | null> =>
      byToken[token] ? { userId: byToken[token]! } : null,
    revoke: async () => {},
    revokeAllForUser: async () => {},
  }
}

function appWith(store: SessionStore, requireAuth: boolean, defaultPrincipal: UserId | null): Hono {
  const app = new Hono()
  app.use('*', authMiddleware({ sessionStore: store, requireAuth, defaultPrincipal }))
  app.get('/who', c => c.json({ userId: getUserId(c) ?? null }))
  return app
}

describe('authMiddleware', () => {
  it('under local trust, a valid Bearer session wins over the default principal', async () => {
    const store = fakeSessionStore({ 'reactor-token': 'reactor' as UserId })
    const app = appWith(store, false, 'local-user' as UserId)
    const res = await app.request('/who', { headers: { Authorization: 'Bearer reactor-token' } })
    expect(await res.json()).toEqual({ userId: 'reactor' })
  })

  it('under local trust with no Bearer, falls back to the default principal', async () => {
    const store = fakeSessionStore({})
    const app = appWith(store, false, 'local-user' as UserId)
    const res = await app.request('/who')
    expect(await res.json()).toEqual({ userId: 'local-user' })
  })

  it('under local trust, an unresolvable Bearer falls back to the default principal', async () => {
    const store = fakeSessionStore({})
    const app = appWith(store, false, 'local-user' as UserId)
    const res = await app.request('/who', { headers: { Authorization: 'Bearer bogus' } })
    expect(await res.json()).toEqual({ userId: 'local-user' })
  })
})
