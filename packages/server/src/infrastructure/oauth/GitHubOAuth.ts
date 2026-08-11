const AUTH_ENDPOINT = 'https://github.com/login/oauth/authorize'
const TOKEN_ENDPOINT = 'https://github.com/login/oauth/access_token'

export interface GitHubOAuthConfig {
  // OAuth client id from the GitHub App.
  readonly clientId: string
  // OAuth client secret.
  readonly clientSecret: string
  // Redirect URI for the source-connection flow.
  // Must match the App's Callback URL.
  readonly redirectUri: string
}

/**
 * Tokens from the GitHub App user-to-server flow.
 * GitHub rotates the refresh token on every refresh,
 * so a refreshed set always carries a new `refreshToken`,
 * unlike Google which keeps one.
 */
export interface GitHubTokenSet {
  readonly accessToken: string
  readonly refreshToken: string
  readonly expiresAt: string
  readonly refreshTokenExpiresAt: string
}

/**
 * Minimal GitHub App user-to-server OAuth client, a mirror of GoogleOAuth.
 * Three calls are needed, build the URL, exchange the code, and refresh.
 * GitHub has no PKCE, and a GitHub App fixes its permissions on the App,
 * so there is no `scope` parameter here.
 *
 * The App must enable expiring user tokens. Without them,
 * GitHub returns no refresh token, and `exchangeCode` throws an error.
 */
export class GitHubOAuth {
  private readonly fetchFn: typeof globalThis.fetch

  constructor(private readonly config: GitHubOAuthConfig, fetchFn: typeof globalThis.fetch = globalThis.fetch) {
    this.fetchFn = fetchFn
  }

  /**
   * Build the URL the user's browser is sent to.
   * `state` MUST be unique per flow,
   * the caller stores it until the callback arrives.
   */
  buildAuthorizationUrl(input: { state: string }): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      state: input.state,
    })
    return `${AUTH_ENDPOINT}?${params.toString()}`
  }

  async exchangeCode(input: { code: string }): Promise<GitHubTokenSet> {
    const payload = await this.postToken(new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      redirect_uri: this.config.redirectUri,
      grant_type: 'authorization_code',
      code: input.code,
    }))
    if (!payload.refresh_token || payload.expires_in === undefined) {
      throw new Error(
        'GitHub did not return a refresh token. Enable expiring user tokens on the GitHub App, then reconnect.',
      )
    }
    return tokenSetFromPayload(payload)
  }

  async refreshAccessToken(refreshToken: string): Promise<GitHubTokenSet> {
    const payload = await this.postToken(new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }))
    if (!payload.refresh_token || payload.expires_in === undefined)
      throw new Error('GitHub refresh did not return a rotated refresh token.')
    return tokenSetFromPayload(payload)
  }

  private async postToken(body: URLSearchParams): Promise<RawTokenResponse> {
    const response = await this.fetchFn(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`GitHub token request failed: ${response.status} ${response.statusText} ${text}`)
    }
    const payload = await response.json() as RawTokenResponse
    // GitHub reports OAuth failures as HTTP 200 with an `error` field,
    // so a non-error status alone does not mean the exchange succeeded.
    if (payload.error)
      throw new Error(`GitHub token request failed: ${payload.error_description ?? payload.error}`)
    return payload
  }
}

interface RawTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  refresh_token_expires_in?: number
  error?: string
  error_description?: string
}

function tokenSetFromPayload(p: RawTokenResponse): GitHubTokenSet {
  return {
    accessToken: p.access_token,
    refreshToken: p.refresh_token!,
    expiresAt: secondsFromNow(p.expires_in!).toISOString(),
    refreshTokenExpiresAt: secondsFromNow(p.refresh_token_expires_in ?? p.expires_in!).toISOString(),
  }
}

function secondsFromNow(seconds: number): Date {
  return new Date(Date.now() + seconds * 1000)
}
