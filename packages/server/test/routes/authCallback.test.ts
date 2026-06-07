import type { OpenAPIHono } from '@hono/zod-openapi'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../../src/app.js'
import { composeFsApp } from '../../src/composeFs.js'

const STUDIO_URL = 'http://localhost:5173'

interface MockedFetchInputs {
  /** Profile the userinfo endpoint will return. */
  profile?: { sub: string, email: string, name: string }
  /** Make the token exchange call fail with a 4xx. */
  tokenFails?: boolean
}

function mockGoogleFetch(inputs: MockedFetchInputs = {}): void {
  const profile = inputs.profile ?? { sub: 'goog-sub-test', email: 'user@example.com', name: 'Test User' }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.includes('oauth2.googleapis.com/token')) {
      if (inputs.tokenFails) {
        return new Response('invalid_grant', { status: 400, statusText: 'Bad Request' })
      }
      return new Response(JSON.stringify({ access_token: 'fake-access-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url.includes('userinfo')) {
      return new Response(JSON.stringify(profile), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    throw new Error(`Unmocked fetch: ${url}`)
  })
}

async function buildAuthApp(): Promise<OpenAPIHono> {
  const braidHome = await mkdtemp(join(tmpdir(), 'braid-auth-callback-'))
  process.env.BRAID_GOOGLE_CLIENT_ID = 'test-client'
  process.env.BRAID_GOOGLE_CLIENT_SECRET = 'test-secret'
  process.env.BRAID_GOOGLE_LOGIN_REDIRECT_URI = `${STUDIO_URL}/auth/google/callback`
  process.env.BRAID_STUDIO_URL = STUDIO_URL
  process.env.BRAID_ALLOWED_DOMAINS = 'example.com'
  const deps = await composeFsApp({ braidHome })
  return createApp(deps)
}

async function startFlow(app: OpenAPIHono): Promise<string> {
  const response = await app.request('/auth/google/start')
  expect(response.status).toBe(200)
  const body = await response.json() as { authorizationUrl: string }
  const url = new URL(body.authorizationUrl)
  const state = url.searchParams.get('state')
  expect(state).not.toBeNull()
  return state!
}

describe('OAuth callback', () => {
  beforeEach(() => {
    mockGoogleFetch()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.BRAID_GOOGLE_CLIENT_ID
    delete process.env.BRAID_GOOGLE_CLIENT_SECRET
    delete process.env.BRAID_GOOGLE_LOGIN_REDIRECT_URI
    delete process.env.BRAID_STUDIO_URL
    delete process.env.BRAID_ALLOWED_DOMAINS
  })

  it('redirects to studio with a session token after a successful sign-in', async () => {
    const app = await buildAuthApp()
    const state = await startFlow(app)

    const response = await app.request(`/auth/google/callback?code=fake-code&state=${state}`)

    expect(response.status).toBe(302)
    const location = response.headers.get('Location')
    expect(location).toMatch(/^http:\/\/localhost:5173#token=/)
  })

  it('redirects to studio with an error when the state token is unknown', async () => {
    const app = await buildAuthApp()

    const response = await app.request('/auth/google/callback?code=anything&state=never-issued')

    expect(response.status).toBe(302)
    const location = response.headers.get('Location') ?? ''
    expect(location).toContain('auth-error=')
    expect(decodeURIComponent(location)).toMatch(/Session expired/)
  })

  it('redirects to studio with an error when Google upstream returns error', async () => {
    const app = await buildAuthApp()

    const response = await app.request('/auth/google/callback?error=access_denied&state=anything')

    expect(response.status).toBe(302)
    const location = response.headers.get('Location') ?? ''
    expect(location).toContain('auth-error=')
  })

  it('redirects to studio with an error when the token exchange fails', async () => {
    mockGoogleFetch({ tokenFails: true })
    const app = await buildAuthApp()
    const state = await startFlow(app)

    const response = await app.request(`/auth/google/callback?code=fake-code&state=${state}`)

    expect(response.status).toBe(302)
    const location = response.headers.get('Location') ?? ''
    expect(location).toContain('auth-error=')
  })

  it('rejects allowlist-failing emails with an error redirect', async () => {
    mockGoogleFetch({ profile: { sub: 'goog-outsider', email: 'outsider@nope.com', name: 'Outsider' } })
    const app = await buildAuthApp()
    const state = await startFlow(app)

    const response = await app.request(`/auth/google/callback?code=fake-code&state=${state}`)

    expect(response.status).toBe(302)
    const location = response.headers.get('Location') ?? ''
    expect(location).toContain('auth-error=')
  })
})
