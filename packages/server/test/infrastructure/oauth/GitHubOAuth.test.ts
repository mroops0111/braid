import { describe, expect, it } from 'vitest'
import { GitHubOAuth } from '../../../src/infrastructure/oauth/GitHubOAuth.js'

const config = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  redirectUri: 'http://localhost:4321/oauth/github/callback',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function fetchReturning(response: Response): typeof globalThis.fetch {
  return (async () => response) as typeof globalThis.fetch
}

describe('GitHubOAuth', () => {
  it('builds an authorization URL without scope or PKCE', () => {
    const oauth = new GitHubOAuth(config)
    const url = new URL(oauth.buildAuthorizationUrl({ state: 'state-123' }))
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize')
    expect(url.searchParams.get('client_id')).toBe(config.clientId)
    expect(url.searchParams.get('redirect_uri')).toBe(config.redirectUri)
    expect(url.searchParams.get('state')).toBe('state-123')
    expect(url.searchParams.get('scope')).toBeNull()
    expect(url.searchParams.get('code_challenge')).toBeNull()
  })

  it('exchangeCode returns a token set with both expiries', async () => {
    const github = new GitHubOAuth(config, fetchReturning(jsonResponse({
      access_token: 'gho-access',
      refresh_token: 'ghr-refresh',
      expires_in: 28800,
      refresh_token_expires_in: 15897600,
    })))
    const tokens = await github.exchangeCode({ code: 'code-1' })
    expect(tokens.accessToken).toBe('gho-access')
    expect(tokens.refreshToken).toBe('ghr-refresh')
    expect(Date.parse(tokens.expiresAt)).toBeGreaterThan(Date.now())
    expect(Date.parse(tokens.refreshTokenExpiresAt)).toBeGreaterThan(Date.parse(tokens.expiresAt))
  })

  it('exchangeCode throws when no refresh token comes back', async () => {
    const github = new GitHubOAuth(config, fetchReturning(jsonResponse({ access_token: 'gho-access', token_type: 'bearer' })))
    await expect(github.exchangeCode({ code: 'code-1' }))
      .rejects
      .toThrow(/Enable expiring user tokens/)
  })

  it('exchangeCode surfaces a GitHub error returned as HTTP 200', async () => {
    const github = new GitHubOAuth(config, fetchReturning(jsonResponse({
      error: 'bad_verification_code',
      error_description: 'The code passed is incorrect or expired.',
    })))
    await expect(github.exchangeCode({ code: 'nope' }))
      .rejects
      .toThrow(/The code passed is incorrect or expired/)
  })

  it('refreshAccessToken returns the rotated set', async () => {
    const github = new GitHubOAuth(config, fetchReturning(jsonResponse({
      access_token: 'gho-access-2',
      refresh_token: 'ghr-refresh-2',
      expires_in: 28800,
      refresh_token_expires_in: 15897600,
    })))
    const tokens = await github.refreshAccessToken('ghr-refresh')
    expect(tokens.accessToken).toBe('gho-access-2')
    expect(tokens.refreshToken).toBe('ghr-refresh-2')
  })

  it('throws on a non-ok HTTP status', async () => {
    const github = new GitHubOAuth(config, fetchReturning(new Response('nope', { status: 500 })))
    await expect(github.refreshAccessToken('ghr-refresh'))
      .rejects
      .toThrow(/GitHub token request failed: 500/)
  })
})
