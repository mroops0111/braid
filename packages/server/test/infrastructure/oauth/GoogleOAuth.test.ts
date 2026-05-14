import { describe, expect, it } from 'vitest'
import { createOAuthState, createPkceVerifier, GoogleOAuth } from '../../../src/infrastructure/oauth/GoogleOAuth.js'

const config = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  redirectUri: 'http://localhost:4321/oauth/google/callback',
}

describe('GoogleOAuth', () => {
  it('builds an authorization URL with the expected params', () => {
    const oauth = new GoogleOAuth(config)
    const state = 'state-123'
    const codeVerifier = createPkceVerifier()
    const url = oauth.buildAuthorizationUrl({
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
      state,
      codeVerifier,
    })
    const parsed = new URL(url)
    expect(parsed.origin + parsed.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(parsed.searchParams.get('client_id')).toBe(config.clientId)
    expect(parsed.searchParams.get('response_type')).toBe('code')
    expect(parsed.searchParams.get('access_type')).toBe('offline')
    expect(parsed.searchParams.get('prompt')).toBe('consent')
    expect(parsed.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.readonly')
    expect(parsed.searchParams.get('state')).toBe(state)
    expect(parsed.searchParams.get('code_challenge')).toMatch(/^[\w-]+$/)
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256')
  })

  it('createPkceVerifier returns a 43-char base64url string', () => {
    const v = createPkceVerifier()
    expect(v).toMatch(/^[\w-]{43}$/)
  })

  it('createOAuthState returns a base64url string', () => {
    expect(createOAuthState()).toMatch(/^[\w-]+$/)
  })
})
