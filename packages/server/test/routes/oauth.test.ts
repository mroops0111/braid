import type { WorkspaceService } from '@braidhq/core'
import type { AbsolutePath, Timestamp, User, UserId, WorkspaceMember, WorkspaceRole } from '@braidhq/schema'
import type { GitHubOAuth } from '../../src/infrastructure/oauth/GitHubOAuth.js'
import type { SecretStore } from '../../src/infrastructure/secrets/SecretStore.js'
import type { UserRegistryFile } from '../../src/infrastructure/users/UserRegistryFile.js'
import type { WorkspaceRegistryFile } from '../../src/infrastructure/workspace/WorkspaceRegistryFile.js'
import { NotFoundError } from '@braidhq/core'
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { errorHandler } from '../../src/middleware/error.js'
import { createOAuthCallbackRouter, createOAuthStartRouter, OAuthFlowStore } from '../../src/routes/oauth.js'

function fakeSecretStore(): { store: SecretStore, data: Map<string, unknown> } {
  const data = new Map<string, unknown>()
  const store: SecretStore = {
    read: async <T>(ns: string, key: string) => data.get(`${ns}/${key}`) as T | undefined,
    write: async (ns, key, value) => { data.set(`${ns}/${key}`, value) },
    delete: async (ns, key) => { data.delete(`${ns}/${key}`) },
  }
  return { store, data }
}

const fakeGithub = {
  buildAuthorizationUrl: ({ state }: { state: string }) => `https://github.com/login/oauth/authorize?state=${state}`,
  exchangeCode: async () => ({ accessToken: 'gha', refreshToken: 'ghr', expiresAt: 'x', refreshTokenExpiresAt: 'y' }),
} as unknown as GitHubOAuth

const owner: User = { id: 'u-owner' as UserId, displayName: 'Ada', serverRole: 'user', createdAt: '2026-01-01T00:00:00Z' as Timestamp }

function fakeUserRegistry(user: User | undefined): UserRegistryFile {
  return { get: async () => user } as unknown as UserRegistryFile
}

function fakeWorkspaceService(exists: boolean): WorkspaceService {
  return {
    findById: async () => {
      if (!exists)
        throw new NotFoundError('Workspace not registered')
      return { rootPath: '/ws' as AbsolutePath }
    },
  } as unknown as WorkspaceService
}

function fakeWorkspaceRegistry(role: WorkspaceRole | undefined): WorkspaceRegistryFile {
  const member: WorkspaceMember | undefined = role ? { userId: 'u-owner' as UserId, role, joinedAt: '2026-01-01T00:00:00Z' as Timestamp } : undefined
  return { getMember: async () => member } as unknown as WorkspaceRegistryFile
}

interface GuardDeps {
  userRegistry: UserRegistryFile
  workspaceService: WorkspaceService
  workspaceRegistry: WorkspaceRegistryFile
}

function guard(options: { exists: boolean, role?: WorkspaceRole }): GuardDeps {
  return {
    userRegistry: fakeUserRegistry(owner),
    workspaceService: fakeWorkspaceService(options.exists),
    workspaceRegistry: fakeWorkspaceRegistry(options.role),
  }
}

function startApp(deps: Parameters<typeof createOAuthStartRouter>[0]): Hono {
  const app = new Hono()
  app.onError(errorHandler)
  app.route('/oauth', createOAuthStartRouter(deps))
  return app
}

function startBody(): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId: 'ws1', sourceId: 'src1' }) }
}

function stateFromUrl(url: string): string {
  return new URL(url).searchParams.get('state')!
}

describe('OAuthFlowStore', () => {
  it('take returns then removes the flow, and unknown state is undefined', () => {
    const store = new OAuthFlowStore()
    store.put('s1', { workspaceId: 'ws1', sourceId: 'src1', createdAt: Date.now() })
    expect(store.take('s1')?.sourceId).toBe('src1')
    expect(store.take('s1')).toBeUndefined()
    expect(store.take('never')).toBeUndefined()
  })

  it('sweeps flows older than ten minutes on put', () => {
    const store = new OAuthFlowStore()
    store.put('stale', { workspaceId: 'ws1', sourceId: 'old', createdAt: Date.now() - 11 * 60 * 1000 })
    store.put('fresh', { workspaceId: 'ws1', sourceId: 'new', createdAt: Date.now() })
    expect(store.take('stale')).toBeUndefined()
    expect(store.take('fresh')?.sourceId).toBe('new')
  })
})

describe('createOAuthStartRouter', () => {
  it('returns 503 when the provider is not configured', async () => {
    const { store } = fakeSecretStore()
    const app = startApp({ secretStore: store, flowStore: new OAuthFlowStore() })
    const res = await app.request('/oauth/github/start', startBody())
    expect(res.status).toBe(503)
  })

  it('forbids a non-owner of an existing workspace', async () => {
    const { store } = fakeSecretStore()
    const app = startApp({ secretStore: store, flowStore: new OAuthFlowStore(), github: fakeGithub, ...guard({ exists: true, role: 'guest' }) })
    const res = await app.request('/oauth/github/start', startBody())
    expect(res.status).toBe(403)
  })

  it('lets an owner of an existing workspace start a connection', async () => {
    const { store } = fakeSecretStore()
    const app = startApp({ secretStore: store, flowStore: new OAuthFlowStore(), github: fakeGithub, ...guard({ exists: true, role: 'owner' }) })
    const res = await app.request('/oauth/github/start', startBody())
    expect(res.status).toBe(200)
    expect((await res.json() as { authorizationUrl: string }).authorizationUrl).toContain('github.com')
  })

  it('allows a not-yet-scaffolded workspace, since the wizard connects before create', async () => {
    const { store } = fakeSecretStore()
    const app = startApp({ secretStore: store, flowStore: new OAuthFlowStore(), github: fakeGithub, ...guard({ exists: false }) })
    const res = await app.request('/oauth/github/start', startBody())
    expect(res.status).toBe(200)
  })
})

describe('createOAuthCallbackRouter', () => {
  function callbackApp(deps: Parameters<typeof createOAuthCallbackRouter>[0]): Hono {
    const app = new Hono()
    app.route('/oauth', createOAuthCallbackRouter(deps))
    return app
  }

  it('renders an error page when the provider passes an error query', async () => {
    const { store } = fakeSecretStore()
    const app = callbackApp({ secretStore: store, flowStore: new OAuthFlowStore(), github: fakeGithub })
    const res = await app.request('/oauth/github/callback?error=access_denied')
    expect(res.status).toBe(400)
    expect(await res.text()).toContain('Authorization failed')
  })

  it('rejects an unrecognised state token', async () => {
    const { store } = fakeSecretStore()
    const app = callbackApp({ secretStore: store, flowStore: new OAuthFlowStore(), github: fakeGithub })
    const res = await app.request('/oauth/github/callback?state=nope&code=abc')
    expect(res.status).toBe(400)
    expect(await res.text()).toContain('not recognised')
  })

  it('persists github tokens with connectedBy from the start flow', async () => {
    const flowStore = new OAuthFlowStore()
    const { store, data } = fakeSecretStore()
    const start = startApp({ secretStore: store, flowStore, github: fakeGithub, ...guard({ exists: true, role: 'owner' }) })
    const startRes = await start.request('/oauth/github/start', startBody())
    const state = stateFromUrl((await startRes.json() as { authorizationUrl: string }).authorizationUrl)

    const callback = callbackApp({ secretStore: store, flowStore, github: fakeGithub })
    const cbRes = await callback.request(`/oauth/github/callback?state=${state}&code=abc`)
    expect(cbRes.status).toBe(200)

    const record = data.get('oauth-github/ws1--src1') as { accessToken: string, connectedBy: { userId: string, displayName: string }, connectedAt: string }
    expect(record.accessToken).toBe('gha')
    expect(record.connectedBy).toEqual({ userId: 'u-owner', displayName: 'Ada' })
    expect(typeof record.connectedAt).toBe('string')
  })
})
