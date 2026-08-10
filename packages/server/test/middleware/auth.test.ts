import type { UserId } from '@braidhq/schema'
import type { ResolvedSession, SessionStore } from '../../src/infrastructure/auth/SessionStore.js'
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { authMiddleware, getUserId } from '../../src/middleware/auth.js'
import { errorHandler } from '../../src/middleware/error.js'

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

  it('under enforced auth, any OAuth callback is public but the start route stays gated', async () => {
    const app = new Hono()
    app.onError(errorHandler)
    app.use('*', authMiddleware({ sessionStore: fakeSessionStore({}), requireAuth: true, defaultPrincipal: null }))
    app.get('/oauth/google/callback', context => context.text('ok'))
    app.get('/oauth/anyprovider/callback', context => context.text('ok'))
    app.post('/oauth/google/start', context => context.text('ok'))

    expect((await app.request('/oauth/google/callback?state=x&code=y')).status).toBe(200)
    expect((await app.request('/oauth/anyprovider/callback?state=x&code=y')).status).toBe(200)
    expect((await app.request('/oauth/google/start', { method: 'POST' })).status).toBe(401)
  })
})
