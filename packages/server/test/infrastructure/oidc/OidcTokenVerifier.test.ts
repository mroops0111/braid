import type { User, UserId } from '@braidhq/schema'
import type { UserRegistryFile } from '../../../src/infrastructure/users/UserRegistryFile.js'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { OidcTokenVerifier } from '../../../src/infrastructure/oidc/OidcTokenVerifier.js'

const ISSUER = 'https://auth.example.com/realms/x'
const AUDIENCE = 'https://braid.example.com'

let signingKey: CryptoKey
let jwks: { keys: unknown[] }

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true })
  signingKey = pair.privateKey
  jwks = { keys: [{ ...await exportJWK(pair.publicKey), alg: 'RS256', use: 'sig', kid: 'test' }] }
})

async function mint(claims: Record<string, unknown>, overrides: { audience?: string, issuer?: string } = {}): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setIssuer(overrides.issuer ?? ISSUER)
    .setAudience(overrides.audience ?? AUDIENCE)
    .setExpirationTime('5m')
    .sign(signingKey)
}

function registry(users: Array<Partial<User>>): UserRegistryFile {
  const rows = users.map(user => ({ id: 'u1' as UserId, displayName: 'x', serverRole: 'user', ...user })) as User[]
  return {
    list: async () => rows,
    get: async (id: UserId) => rows.find(user => user.id === id) ?? null,
  } as unknown as UserRegistryFile
}

function verifier(userRegistry: UserRegistryFile, audience = AUDIENCE): OidcTokenVerifier {
  const fetchImpl = vi.fn(async (url: string | URL) => {
    const target = String(url)
    if (target.endsWith('/.well-known/openid-configuration'))
      return new Response(JSON.stringify({ issuer: ISSUER, jwks_uri: `${ISSUER}/keys` }), { status: 200 })
    if (target === `${ISSUER}/keys`)
      return new Response(JSON.stringify(jwks), { status: 200, headers: { 'content-type': 'application/json' } })
    return new Response('not found', { status: 404 })
  }) as unknown as typeof globalThis.fetch
  return new OidcTokenVerifier({ issuer: ISSUER, audience, userRegistry, fetch: fetchImpl })
}

describe('oidcTokenVerifier', () => {
  it('declines an opaque token rather than judging it, so the session store keeps its turn', async () => {
    expect(await verifier(registry([])).verify('a-session-token')).toBeNull()
  })

  it('matches a token to the user its email names', async () => {
    const users = registry([{ id: 'user-abc' as UserId, email: 'alice@example.com' }])
    const token = await mint({ sub: 'google-1', email: 'alice@example.com' })
    expect(await verifier(users).verify(token)).toEqual({ userId: 'user-abc' })
  })

  it('ignores case in the email, since an identity provider may not preserve it', async () => {
    const users = registry([{ id: 'user-abc' as UserId, email: 'alice@example.com' }])
    const token = await mint({ sub: 'google-1', email: 'Alice@Example.COM' })
    expect(await verifier(users).verify(token)).toEqual({ userId: 'user-abc' })
  })

  it('refuses a token minted for another service, which is what a confused deputy accepts', async () => {
    const users = registry([{ id: 'user-abc' as UserId, email: 'alice@example.com' }])
    const token = await mint({ email: 'alice@example.com' }, { audience: 'https://someone-else.example.com' })
    await expect(verifier(users).verify(token)).rejects.toThrow(/rejected/i)
  })

  it('refuses a token from an issuer this deployment does not trust', async () => {
    const users = registry([{ id: 'user-abc' as UserId, email: 'alice@example.com' }])
    const token = await mint({ email: 'alice@example.com' }, { issuer: 'https://evil.example.com' })
    await expect(verifier(users).verify(token)).rejects.toThrow(/rejected/i)
  })

  it('refuses a valid token naming nobody here, rather than inventing a caller', async () => {
    const token = await mint({ sub: 'google-1', email: 'stranger@example.com' })
    await expect(verifier(registry([])).verify(token)).rejects.toThrow(/names nobody/i)
  })
})
