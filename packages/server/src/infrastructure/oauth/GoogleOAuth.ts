import { createHash, randomBytes } from 'node:crypto'

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo'

/**
 * Profile fields Braid needs after Google authn.
 * `sub` is the stable Google account id, used as the join key into `users.json`.
 */
export interface GoogleProfile {
  readonly sub: string
  readonly email: string
  readonly displayName: string
  readonly emailVerified?: boolean
}

export interface GoogleOAuthConfig {
  // OAuth client id from the user's GCP project.
  readonly clientId: string
  // OAuth client secret.
  readonly clientSecret: string
  // Redirect URI used by the Drive provisioning flow (existing OAuth router).
  // Both paths must be registered in the GCP OAuth client's authorised redirect URIs list.
  readonly redirectUri: string
  // Redirect URI used by the user-login flow.
  // Optional, falls back to the Drive `redirectUri` if unset,
  // which is what local dev wants (one path, one registered URI).
  // Production usually points this at `${apiUrl}/auth/google/callback`,
  // so the two flows mount on different routes.
  readonly loginRedirectUri?: string
}

export interface AuthorizationUrlInput {
  // OAuth scopes requested. Braid passes Drive read-only.
  readonly scopes: readonly string[]
  // State token (CSRF plus flow-restore).
  readonly state: string
  // PKCE verifier. The URL embeds its SHA-256 challenge.
  readonly codeVerifier: string
}

export interface TokenSet {
  readonly accessToken: string
  readonly refreshToken: string
  readonly expiresAt: string
  readonly scope: string
  readonly tokenType: string
}

export interface RefreshedAccessToken {
  readonly accessToken: string
  readonly expiresAt: string
}

/**
 * Minimal Google OAuth 2.0 client for the installed-app or web flow.
 * We skip `openid-client` and `google-auth-library`,
 * because only four calls are needed (build URL, exchange code, refresh, revoke).
 * Avoiding a heavyweight dependency keeps the server's install footprint small,
 * and the auth surface auditable.
 */
export class GoogleOAuth {
  constructor(private readonly config: GoogleOAuthConfig) {}

  /**
   * Build the URL the user's browser is sent to. `state` and `codeVerifier`
   * MUST be unique per flow,
   * the caller stores them in pending-state until the callback arrives.
   */
  buildAuthorizationUrl(input: AuthorizationUrlInput): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: input.scopes.join(' '),
      access_type: 'offline', // yields refresh_token in the response
      prompt: 'consent', // ensure refresh_token even on re-auth
      include_granted_scopes: 'true',
      state: input.state,
      code_challenge: pkceChallenge(input.codeVerifier),
      code_challenge_method: 'S256',
    })
    return `${AUTH_ENDPOINT}?${params.toString()}`
  }

  async exchangeCode(input: { code: string, codeVerifier: string }): Promise<TokenSet> {
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      redirect_uri: this.config.redirectUri,
      grant_type: 'authorization_code',
      code: input.code,
      code_verifier: input.codeVerifier,
    })
    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`Google token exchange failed: ${response.status} ${response.statusText} ${text}`)
    }
    const payload = await response.json() as RawTokenResponse
    if (!payload.refresh_token) {
      // Google only returns refresh_token on first consent.
      // Without one, the caller can't store anything useful for next time.
      throw new Error('Google did not return a refresh_token. Add prompt=consent and ensure access_type=offline.')
    }
    return tokenSetFromPayload(payload)
  }

  /**
   * Login flow URL. Same client and redirect as the Drive flow,
   * but with `openid email profile` scopes and no `prompt=consent`.
   * Google suppresses the consent screen when the user has already approved those scopes,
   * which is what login wants,
   * unlike Drive where a refresh_token is required and `prompt=consent` is forced.
   */
  buildLoginUrl(input: { state: string, codeVerifier: string }): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.loginRedirectUri(),
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'online',
      include_granted_scopes: 'true',
      state: input.state,
      code_challenge: pkceChallenge(input.codeVerifier),
      code_challenge_method: 'S256',
    })
    return `${AUTH_ENDPOINT}?${params.toString()}`
  }

  /** Path Google sends the login callback to. Routed under `/auth/google/callback`. */
  loginRedirectUri(): string {
    return this.config.loginRedirectUri ?? this.config.redirectUri
  }

  /**
   * Exchange an authorization code from the login flow for the user's profile.
   * Does NOT require `refresh_token`, since login is one-shot.
   * The Braid server issues its own session afterwards,
   * so Google's tokens are discarded after this call.
   * Uses the userinfo endpoint instead of decoding the id_token,
   * so no JWT verifier is pulled in just to read 3 fields.
   */
  async loginWithCode(input: { code: string, codeVerifier: string }): Promise<GoogleProfile> {
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      redirect_uri: this.loginRedirectUri(),
      grant_type: 'authorization_code',
      code: input.code,
      code_verifier: input.codeVerifier,
    })
    const tokenResponse = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!tokenResponse.ok) {
      const text = await tokenResponse.text().catch(() => '')
      throw new Error(`Google login token exchange failed: ${tokenResponse.status} ${tokenResponse.statusText} ${text}`)
    }
    const { access_token } = await tokenResponse.json() as { access_token: string }

    const userinfoResponse = await fetch(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${access_token}` },
    })
    if (!userinfoResponse.ok) {
      const text = await userinfoResponse.text().catch(() => '')
      throw new Error(`Google userinfo fetch failed: ${userinfoResponse.status} ${userinfoResponse.statusText} ${text}`)
    }
    const userinfo = await userinfoResponse.json() as {
      sub: string
      email: string
      email_verified?: boolean
      name?: string
      given_name?: string
    }
    return {
      sub: userinfo.sub,
      email: userinfo.email,
      displayName: userinfo.name ?? userinfo.given_name ?? userinfo.email,
      ...(userinfo.email_verified !== undefined ? { emailVerified: userinfo.email_verified } : {}),
    }
  }

  async refreshAccessToken(refreshToken: string): Promise<RefreshedAccessToken> {
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    })
    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`Google token refresh failed: ${response.status} ${response.statusText} ${text}`)
    }
    const payload = await response.json() as RawTokenResponse
    return {
      accessToken: payload.access_token,
      expiresAt: secondsFromNow(payload.expires_in).toISOString(),
    }
  }
}

interface RawTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope: string
  token_type: string
}

function tokenSetFromPayload(p: RawTokenResponse): TokenSet {
  return {
    accessToken: p.access_token,
    refreshToken: p.refresh_token!,
    expiresAt: secondsFromNow(p.expires_in).toISOString(),
    scope: p.scope,
    tokenType: p.token_type,
  }
}

function secondsFromNow(seconds: number): Date {
  return new Date(Date.now() + seconds * 1000)
}

function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

/**
 * Helper for callers: produce a fresh PKCE verifier (32 bytes, base64url).
 * Caller stashes alongside the `state` token until the callback returns.
 */
export function createPkceVerifier(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * CSRF state token. Random 16 bytes, opaque to Google.
 */
export function createOAuthState(): string {
  return randomBytes(16).toString('base64url')
}
