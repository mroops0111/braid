/**
 * Where a browser sign-in sends the person, and what comes back.
 *
 * Braid runs the authorization code flow itself and issues its own session
 * afterwards, the pattern OAuth 2.0 for Browser-Based Applications
 * recommends, so no token ever reaches browser storage.
 *
 * The port exists because a deployment has exactly one of these, either
 * Braid's own Google client or an authorization server it trusts, and the
 * work after the exchange is the same either way. Adding a third provider is
 * an implementation, not a change to the routes or the session handling.
 */
export interface LoginProvider {
  /**
   * Path segment this provider answers on, under `/auth`.
   *
   * Part of the redirect URI registered with the provider, so it is fixed
   * once a deployment is live and cannot be renamed casually.
   */
  readonly id: string
  /** Where to send the browser. `state` and `codeVerifier` are per-flow. */
  buildLoginUrl: (input: { state: string, codeVerifier: string }) => string | Promise<string>
  /** Who came back, once the code is exchanged. */
  loginWithCode: (input: { code: string, codeVerifier: string }) => Promise<LoginProfile>
  /**
   * Where to send the browser to end the session at the provider too.
   *
   * Clearing Braid's own session is only half of signing out. The provider
   * keeps its own, so the next sign-in returns immediately without asking
   * who is there, which on a shared machine hands the next person the
   * previous one's account.
   *
   * Absent when the provider offers no such endpoint, which is the case for
   * Braid's own Google client. There the deployment is the only session to
   * end, and Google's own stays deliberately untouched.
   */
  endSessionUrl?: (input: { returnTo: string }) => Promise<string | undefined>
}

/**
 * The person, as the provider describes them.
 *
 * `sub` names them inside the provider and survives an email change, so it is
 * the better join key. `email` is what an allowlist and an invite are written
 * against, so both are carried.
 */
export interface LoginProfile {
  readonly sub: string
  readonly email: string
  readonly displayName: string
}
