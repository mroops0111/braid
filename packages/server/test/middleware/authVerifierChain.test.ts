import type { UserId } from '@braidhq/schema'
import type { AccessTokenVerifier } from '../../src/infrastructure/auth/AccessTokenVerifier.js'
import type { SessionStore } from '../../src/infrastructure/auth/SessionStore.js'
import { UnauthorizedError } from '@braidhq/core'
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { authMiddleware, getUserId } from '../../src/middleware/auth.js'

function appWith(input: {
  sessionStore: SessionStore
  verifiers?: readonly AccessTokenVerifier[]
}) {
  const app = new Hono()
  app.use('*', authMiddleware({
    sessionStore: input.sessionStore,
    requireAuth: true,
    defaultPrincipal: null,
    ...(input.verifiers ? { accessTokenVerifiers: input.verifiers } : {}),
  }))
  app.onError((error, context) => context.json({ message: error.message }, 401))
  app.get('/who', context => context.json({ userId: getUserId(context) }))
  return app
}

function store(resolve: SessionStore['resolve']): SessionStore {
  return { resolve, issue: vi.fn(), revoke: vi.fn(), revokeAllForUser: vi.fn() } as unknown as SessionStore
}

const bearer = { headers: { authorization: 'Bearer t' } }

describe('auth verifier chain', () => {
  it('takes the session store first, so the browser path is unchanged', async () => {
    const app = appWith({
      sessionStore: store(async () => ({ userId: 'session-user' as UserId })),
      verifiers: [{ verify: vi.fn() }],
    })
    expect(await (await app.request('/who', bearer)).json()).toEqual({ userId: 'session-user' })
  })

  it('does not consult a verifier once the session store answered', async () => {
    const verify = vi.fn()
    const app = appWith({
      sessionStore: store(async () => ({ userId: 'session-user' as UserId })),
      verifiers: [{ verify }],
    })
    await app.request('/who', bearer)
    expect(verify).not.toHaveBeenCalled()
  })

  it('falls through to a verifier when the token is not a session', async () => {
    const app = appWith({
      sessionStore: store(async () => null),
      verifiers: [{ verify: async () => ({ userId: 'oidc-user' as UserId }) }],
    })
    expect(await (await app.request('/who', bearer)).json()).toEqual({ userId: 'oidc-user' })
  })

  it('tries the next verifier when one declines, since declining is not judging', async () => {
    const app = appWith({
      sessionStore: store(async () => null),
      verifiers: [
        { verify: async () => null },
        { verify: async () => ({ userId: 'second' as UserId }) },
      ],
    })
    expect(await (await app.request('/who', bearer)).json()).toEqual({ userId: 'second' })
  })

  it('surfaces a verifier that recognised and refused, rather than reporting an unknown token', async () => {
    const app = appWith({
      sessionStore: store(async () => null),
      verifiers: [
        { verify: async () => {
          throw new UnauthorizedError('Token rejected: expired')
        } },
        { verify: async () => ({ userId: 'never' as UserId }) },
      ],
    })
    const body = await (await app.request('/who', bearer)).json() as { message: string }
    expect(body.message).toMatch(/expired/)
  })

  it('refuses when nobody claims the token', async () => {
    const app = appWith({
      sessionStore: store(async () => null),
      verifiers: [{ verify: async () => null }],
    })
    expect((await app.request('/who', bearer)).status).toBe(401)
  })

  it('works with no verifiers at all, which is every deployment that names no issuer', async () => {
    const app = appWith({ sessionStore: store(async () => ({ userId: 'session-user' as UserId })) })
    expect((await app.request('/who', bearer)).status).toBe(200)
  })
})
