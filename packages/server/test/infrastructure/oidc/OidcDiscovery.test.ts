import { describe, expect, it, vi } from 'vitest'
import { discoverOidcMetadata } from '../../../src/infrastructure/oidc/OidcDiscovery.js'

function respond(map: Record<string, unknown>): typeof globalThis.fetch {
  return vi.fn(async (url: string | URL) => {
    const body = map[String(url)]
    if (body === undefined)
      return new Response('not found', { status: 404 })
    return new Response(JSON.stringify(body), { status: 200 })
  }) as unknown as typeof globalThis.fetch
}

const ISSUER = 'https://auth.example.com/realms/x'

describe('discoverOidcMetadata', () => {
  it('reads the OpenID document', async () => {
    const fetchImpl = respond({
      [`${ISSUER}/.well-known/openid-configuration`]: { issuer: ISSUER, jwks_uri: `${ISSUER}/keys` },
    })
    expect(await discoverOidcMetadata(ISSUER, fetchImpl)).toEqual({ issuer: ISSUER, jwksUri: `${ISSUER}/keys` })
  })

  it('falls back to the plain OAuth document, since not every server is an OpenID provider', async () => {
    const fetchImpl = respond({
      [`${ISSUER}/.well-known/oauth-authorization-server`]: { issuer: ISSUER, jwks_uri: `${ISSUER}/keys` },
    })
    expect((await discoverOidcMetadata(ISSUER, fetchImpl)).jwksUri).toBe(`${ISSUER}/keys`)
  })

  it('tolerates a trailing slash on the issuer it was given', async () => {
    const fetchImpl = respond({
      [`${ISSUER}/.well-known/openid-configuration`]: { issuer: `${ISSUER}/`, jwks_uri: `${ISSUER}/keys` },
    })
    expect(await discoverOidcMetadata(`${ISSUER}/`, fetchImpl)).toBeDefined()
  })

  it('refuses a document describing a different issuer, which would trust the wrong keys', async () => {
    const fetchImpl = respond({
      [`${ISSUER}/.well-known/openid-configuration`]: { issuer: 'https://evil.example.com', jwks_uri: 'https://evil.example.com/keys' },
    })
    await expect(discoverOidcMetadata(ISSUER, fetchImpl)).rejects.toThrow(/expected/)
  })

  it('refuses a document with no key set to verify against', async () => {
    const fetchImpl = respond({ [`${ISSUER}/.well-known/openid-configuration`]: { issuer: ISSUER } })
    await expect(discoverOidcMetadata(ISSUER, fetchImpl)).rejects.toThrow(/jwks_uri/)
  })

  it('names both paths it tried when neither answers', async () => {
    await expect(discoverOidcMetadata(ISSUER, respond({}))).rejects.toThrow(/openid-configuration.*oauth-authorization-server/s)
  })
})
