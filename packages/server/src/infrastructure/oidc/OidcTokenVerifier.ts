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
  /**
   * Whether an email may still reach this deployment.
   *
   * Narrowed to the one question asked, so this stays independent of how the
   * answer is reached, whether an allowed domain, an allowlist, or an invite.
   */
  readonly accessPolicy: SignInPolicy
  readonly fetch?: typeof globalThis.fetch
}

export interface SignInPolicy {
  decide: (email: string) => Promise<{ readonly allow: boolean, readonly reason?: string }>
}

interface Claims {
  readonly sub?: unknown
  readonly email?: unknown
}

function emailOf(claims: Claims): string | null {
  return typeof claims.email === 'string' && claims.email.length > 0
    ? claims.email.toLowerCase()
    : null
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

    const email = emailOf(claims)
    if (!email) {
      throw new UnauthorizedError(
        'Token is valid but carries no email claim. '
        + 'The authorization server must include one.',
      )
    }
    const user = await this.resolveUser(email)
    if (!user) {
      throw new UnauthorizedError(
        `Token is valid but no user of this deployment has the email "${email}".`,
      )
    }
    // The browser door runs this same policy at every login,
    // so this one has to as well.
    // Without it, dropping a domain or revoking an invite closes one door,
    // and leaves a token minted before the change working indefinitely.
    const decision = await this.options.accessPolicy.decide(email)
    if (!decision.allow)
      throw new UnauthorizedError(decision.reason ?? `"${email}" is no longer authorized to sign in.`)
    return { userId: user }
  }

  /**
   * Match the token to a user record.
   *
   * By email, which is what the Google login already keys on,
   * so the same person arriving through either door lands on one record,
   * rather than accumulating two.
   *
   * Not by `sub`. That names the person inside the issuer,
   * and Braid's own ids are its own, so the two never coincide.
   * Carrying an issuer's subject would mean storing it first,
   * which is a decision about identity rather than a lookup.
   */
  private async resolveUser(email: string): Promise<UserId | null> {
    const users = await this.options.userRegistry.list()
    return users.find(user => user.email?.toLowerCase() === email)?.id ?? null
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
