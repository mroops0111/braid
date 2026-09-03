import type { LoginProfile, LoginProvider } from '../auth/LoginProvider.js'
import type { OidcMetadata } from './OidcDiscovery.js'
import { Buffer } from 'node:buffer'
import { UnauthorizedError } from '@braidhq/core'
import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose'
import { discoverOidcMetadata } from './OidcDiscovery.js'

export interface OidcLoginProviderOptions {
  readonly issuer: string
  readonly clientId: string
  readonly clientSecret: string
  /** Where the issuer sends the browser back, registered with it. */
  readonly redirectUri: string
  readonly fetch?: typeof globalThis.fetch
}

interface IdTokenClaims {
  readonly sub?: unknown
  readonly email?: unknown
  readonly name?: unknown
  readonly preferred_username?: unknown
}

/**
 * Signs a person in against the authorization server Braid already trusts.
 *
 * The same issuer that mints tokens for the MCP endpoint, so a deployment
 * configures one identity provider and both doors answer to it. Google, or
 * any other upstream, is federated there rather than wired into Braid twice.
 *
 * Only the id token is read. Braid issues its own session afterwards, so it
 * never needs the access token, and asking for an audience it does not use
 * would be a claim on the authorization server it does not need to make.
 */
export class OidcLoginProvider implements LoginProvider {
  readonly id = 'oidc'
  private metadata: Promise<OidcMetadata> | undefined
  private jwks: ReturnType<typeof createRemoteJWKSet> | undefined

  constructor(private readonly options: OidcLoginProviderOptions) {}

  async buildLoginUrl(input: { state: string, codeVerifier: string }): Promise<string> {
    const metadata = await this.metadataOnce()
    if (!metadata.authorizationEndpoint) {
      throw new UnauthorizedError(
        `Issuer "${this.options.issuer}" publishes no authorization endpoint, so it cannot sign a person in.`,
      )
    }
    const url = new URL(metadata.authorizationEndpoint)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', this.options.clientId)
    url.searchParams.set('redirect_uri', this.options.redirectUri)
    url.searchParams.set('scope', 'openid email profile')
    url.searchParams.set('state', input.state)
    url.searchParams.set('code_challenge', await pkceChallenge(input.codeVerifier))
    url.searchParams.set('code_challenge_method', 'S256')
    return url.toString()
  }

  async loginWithCode(input: { code: string, codeVerifier: string }): Promise<LoginProfile> {
    const metadata = await this.metadataOnce()
    if (!metadata.tokenEndpoint)
      throw new UnauthorizedError(`Issuer "${this.options.issuer}" publishes no token endpoint.`)

    const send = this.options.fetch ?? globalThis.fetch
    const response = await send(metadata.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: input.code,
        redirect_uri: this.options.redirectUri,
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        code_verifier: input.codeVerifier,
      }),
    })
    if (!response.ok)
      throw new UnauthorizedError(`Sign-in failed at the authorization server (${response.status}).`)

    const payload = await response.json() as { id_token?: unknown }
    if (typeof payload.id_token !== 'string')
      throw new UnauthorizedError('The authorization server returned no id token, so Braid cannot tell who signed in.')

    // Verified rather than decoded. The response arrived over TLS from the
    // token endpoint, but checking the signature keeps this honest if the
    // flow is ever changed to receive it anywhere else.
    const { payload: claims } = await jwtVerify(payload.id_token, await this.keySet(), {
      issuer: metadata.issuer,
      audience: this.options.clientId,
    })
    return toProfile(claims)
  }

  /**
   * RP-Initiated Logout, per OpenID Connect RP-Initiated Logout 1.0.
   *
   * Identified by `client_id` rather than `id_token_hint`, because Braid
   * issues its own session after sign-in and never keeps the id token.
   * The authorization server must list `returnTo` as a post-logout redirect,
   * or it will end the session and then refuse to send the browser back.
   */
  async endSessionUrl(input: { returnTo: string }): Promise<string | undefined> {
    const metadata = await this.metadataOnce()
    if (!metadata.endSessionEndpoint)
      return undefined
    const url = new URL(metadata.endSessionEndpoint)
    url.searchParams.set('client_id', this.options.clientId)
    url.searchParams.set('post_logout_redirect_uri', input.returnTo)
    return url.toString()
  }

  private metadataOnce(): Promise<OidcMetadata> {
    this.metadata ??= discoverOidcMetadata(this.options.issuer, this.options.fetch).catch((error: unknown) => {
      this.metadata = undefined
      throw error
    })
    return this.metadata
  }

  private async keySet(): Promise<ReturnType<typeof createRemoteJWKSet>> {
    if (!this.jwks) {
      const metadata = await this.metadataOnce()
      this.jwks = createRemoteJWKSet(new URL(metadata.jwksUri), {
        ...(this.options.fetch ? { [customFetch]: this.options.fetch } : {}),
      })
    }
    return this.jwks
  }
}

function toProfile(claims: IdTokenClaims): LoginProfile {
  if (typeof claims.sub !== 'string' || claims.sub.length === 0)
    throw new UnauthorizedError('The id token carries no subject.')
  if (typeof claims.email !== 'string' || claims.email.length === 0) {
    throw new UnauthorizedError(
      'The id token carries no email claim, which is what Braid matches a person by. '
      + 'Configure the authorization server to release it.',
    )
  }
  const name = typeof claims.name === 'string' && claims.name.length > 0
    ? claims.name
    : typeof claims.preferred_username === 'string' && claims.preferred_username.length > 0
      ? claims.preferred_username
      : claims.email
  return { sub: claims.sub, email: claims.email, displayName: name }
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return Buffer.from(digest).toString('base64url')
}
