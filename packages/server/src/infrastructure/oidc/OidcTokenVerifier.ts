import type { UserId } from '@braidhq/schema'
import type { AccessTokenVerifier, VerifiedCaller } from '../auth/AccessTokenVerifier.js'
import type { UserRegistryFile } from '../users/UserRegistryFile.js'
import type { OidcMetadata } from './OidcDiscovery.js'
import { UnauthorizedError } from '@braidhq/core'
import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose'
import { discoverOidcMetadata } from './OidcDiscovery.js'

export interface OidcTokenVerifierOptions {
  /** Issuer to trust, the `iss` every accepted token must carry. */
  readonly issuer: string
  /**
   * Value this deployment answers to.
   *
   * Checked because a token minted for another service is not a licence to
   * act here, and accepting one is how a resource server becomes a confused
   * deputy for whoever holds it.
   */
  readonly audience: string
  readonly userRegistry: UserRegistryFile
  readonly fetch?: typeof globalThis.fetch
}

interface Claims {
  readonly sub?: unknown
  readonly email?: unknown
}

/**
 * Accepts an access token an authorization server issued for this deployment.
 *
 * Braid stays a resource server here. It never issues one of these and never
 * runs a login for them, it reads the issuer's published keys and checks what
 * arrives, which is what lets a deployment put its own identity provider in
 * front without Braid knowing which one.
 */
export class OidcTokenVerifier implements AccessTokenVerifier {
  private metadata: Promise<OidcMetadata> | undefined
  private jwks: ReturnType<typeof createRemoteJWKSet> | undefined

  constructor(private readonly options: OidcTokenVerifierOptions) {}

  async verify(token: string): Promise<VerifiedCaller | null> {
    // A session token is opaque, so anything without three segments belongs
    // to another verifier rather than being a token this one should reject.
    if (token.split('.').length !== 3)
      return null

    const keys = await this.keySet()
    let claims: Claims
    try {
      const result = await jwtVerify(token, keys, {
        issuer: (await this.metadataOnce()).issuer,
        audience: this.options.audience,
      })
      claims = result.payload
    }
    catch (error) {
      // Recognised and refused, so the caller learns why rather than falling
      // through to a verifier that would only say the header was missing.
      throw new UnauthorizedError(`Token rejected: ${error instanceof Error ? error.message : String(error)}`)
    }

    const user = await this.resolveUser(claims)
    if (!user)
      throw new UnauthorizedError('Token is valid but names nobody with access here.')
    return { userId: user }
  }

  /**
   * Match the token to a user record.
   *
   * Email first, since that is what the Google login already keys on, so the
   * same person arriving through either door lands on one record rather than
   * accumulating two.
   */
  private async resolveUser(claims: Claims): Promise<UserId | null> {
    if (typeof claims.email === 'string' && claims.email.length > 0) {
      const byEmail = await this.userRegistryByEmail(claims.email)
      if (byEmail)
        return byEmail
    }
    if (typeof claims.sub === 'string' && claims.sub.length > 0) {
      const bySub = await this.options.userRegistry.get(claims.sub as UserId)
      if (bySub)
        return bySub.id
    }
    return null
  }

  private async userRegistryByEmail(email: string): Promise<UserId | null> {
    const lower = email.toLowerCase()
    const users = await this.options.userRegistry.list()
    return users.find(user => user.email?.toLowerCase() === lower)?.id ?? null
  }

  private metadataOnce(): Promise<OidcMetadata> {
    // Fetched once per process. A failure is not cached, so a server that
    // booted before its issuer did recovers without a restart.
    this.metadata ??= discoverOidcMetadata(this.options.issuer, this.options.fetch).catch((error: unknown) => {
      this.metadata = undefined
      throw error
    })
    return this.metadata
  }

  private async keySet(): Promise<ReturnType<typeof createRemoteJWKSet>> {
    if (!this.jwks) {
      const metadata = await this.metadataOnce()
      // jose caches the key set and refetches on an unknown key id,
      // so a rotation is picked up without a restart. It reaches for the
      // global fetch unless handed one, which would leave the injected
      // implementation covering discovery but not the keys themselves.
      this.jwks = createRemoteJWKSet(new URL(metadata.jwksUri), {
        ...(this.options.fetch ? { [customFetch]: this.options.fetch } : {}),
      })
    }
    return this.jwks
  }
}
