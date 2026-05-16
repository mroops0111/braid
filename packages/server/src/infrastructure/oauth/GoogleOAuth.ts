import { createHash, randomBytes } from 'node:crypto'

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

export interface GoogleOAuthConfig {
  /** OAuth client id from the user's GCP project. */
  readonly clientId: string
  /** OAuth client secret. */
  readonly clientSecret: string
  /** Absolute redirect URI registered in the GCP OAuth client. */
  readonly redirectUri: string
}

export interface AuthorizationUrlInput {
  /** OAuth scope(s) requested. Braid passes Drive read-only. */
  readonly scopes: readonly string[]
  /** State token (CSRF + flow-restore). */
  readonly state: string
  /** PKCE verifier; the URL embeds its SHA-256 challenge. */
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
 * Minimal Google OAuth 2.0 client for installed-app / web flow.
 *
 * Why not `openid-client` or `google-auth-library`: we only need 4 calls
 * (build URL, exchange code, refresh, revoke); avoiding a heavyweight
 * dependency keeps the server's install footprint small and the auth
 * surface auditable.
 */
export class GoogleOAuth {
  constructor(private readonly config: GoogleOAuthConfig) {}

  /**
   * Build the URL the user's browser is sent to. `state` and `codeVerifier`
   * MUST be unique per flow; the caller stores them in pending-state until
   * the callback arrives.
   */
  buildAuthorizationUrl(input: AuthorizationUrlInput): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: input.scopes.join(' '),
      access_type: 'offline', // → refresh_token in response
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
      // Google only returns refresh_token on first consent. If we don't have
      // one, the caller can't store anything useful for next time.
      throw new Error('Google did not return a refresh_token. Add prompt=consent and ensure access_type=offline.')
    }
    return tokenSetFromPayload(payload)
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
