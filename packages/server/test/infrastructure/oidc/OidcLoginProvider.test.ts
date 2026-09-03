import { describe, expect, it, vi } from 'vitest'
import { OidcLoginProvider } from '../../../src/infrastructure/oidc/OidcLoginProvider.js'

const ISSUER = 'https://as.example.com'

function providerWith(metadata: Record<string, unknown>): OidcLoginProvider {
  const fetchImpl = vi.fn(async (url: string | URL) => {
    if (String(url).endsWith('/.well-known/openid-configuration'))
      return new Response(JSON.stringify({ issuer: ISSUER, jwks_uri: `${ISSUER}/keys`, ...metadata }), { status: 200 })
    return new Response('not found', { status: 404 })
  }) as unknown as typeof globalThis.fetch
  return new OidcLoginProvider({
    issuer: ISSUER,
    clientId: 'braid-studio',
    clientSecret: 'shh',
    redirectUri: 'https://braid.example.com/auth/oidc/callback',
    fetch: fetchImpl,
  })
}

describe('oidcLoginProvider end session', () => {
  it('names itself and where to come back, since Braid keeps no id token to hint with', async () => {
    const provider = providerWith({ end_session_endpoint: `${ISSUER}/logout` })
    const url = new URL((await provider.endSessionUrl({ returnTo: 'https://braid.example.com/' }))!)
    expect(url.origin + url.pathname).toBe(`${ISSUER}/logout`)
    expect(url.searchParams.get('client_id')).toBe('braid-studio')
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe('https://braid.example.com/')
  })

  it('offers nothing when the issuer publishes no logout endpoint', async () => {
    // Signing out then stays local, rather than sending the browser somewhere
    // that would answer with an error page.
    const provider = providerWith({})
    expect(await provider.endSessionUrl({ returnTo: 'https://braid.example.com/' })).toBeUndefined()
  })

  it('builds an authorization url with PKCE and the scopes an email match needs', async () => {
    const provider = providerWith({ authorization_endpoint: `${ISSUER}/auth` })
    const url = new URL(await provider.buildLoginUrl({ state: 's', codeVerifier: 'v'.repeat(43) }))
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).not.toBeNull()
    expect(url.searchParams.get('scope')).toContain('email')
    expect(url.searchParams.get('state')).toBe('s')
  })
})
