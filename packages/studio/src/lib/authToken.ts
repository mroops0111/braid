/**
 * Bearer session token issued by the Braid server's `/auth/google/callback`.
 * Persisted in `localStorage` for v0.2; Tauri builds will move this to
 * the OS keyring in a later phase.
 *
 * Storage is per-origin: the same browser session can't authenticate
 * to two different Braid servers simultaneously today (Phase D adds
 * multi-server with keyring). For now the token corresponds to whatever
 * `serverUrl` is configured.
 */
const STORAGE_KEY = 'braid:authToken'
const EVENT_NAME = 'braid:authTokenChanged'

export function getAuthToken(): string | null {
  if (typeof localStorage === 'undefined')
    return null
  return localStorage.getItem(STORAGE_KEY)
}

export function setAuthToken(token: string | null): void {
  if (typeof localStorage === 'undefined')
    return
  if (token && token.length > 0)
    localStorage.setItem(STORAGE_KEY, token)
  else
    localStorage.removeItem(STORAGE_KEY)
  if (typeof window !== 'undefined')
    window.dispatchEvent(new CustomEvent(EVENT_NAME))
}

export function clearAuthToken(): void {
  setAuthToken(null)
}

/**
 * One-shot extractor for the post-OAuth redirect. The server sends
 * `<studioUrl>#token=<token>` (or `#auth-error=<msg>`) after a
 * successful login; the SPA reads, persists, and clears the fragment
 * so a refresh doesn't replay the token through the URL bar.
 */
export function consumeOAuthRedirect(): { token?: string, error?: string } {
  if (typeof window === 'undefined')
    return {}
  const hash = window.location.hash
  if (!hash || hash.length < 2)
    return {}
  const params = new URLSearchParams(hash.slice(1))
  const token = params.get('token') ?? undefined
  const error = params.get('auth-error') ?? undefined
  if (token || error) {
    // Strip the fragment without triggering a navigation. `pushState`
    // keeps the SPA router state intact (hash-based routes still work
    // for the underlying app — we only had `#token=` / `#auth-error=`
    // riding on the hash from the server's redirect).
    const cleaned = window.location.pathname + window.location.search
    window.history.replaceState(null, '', cleaned)
  }
  return { ...(token ? { token } : {}), ...(error ? { error } : {}) }
}

/**
 * Hook for components that want to re-render on token changes
 * (Login page redirects, logout button). Implementation lives in
 * `useAuthToken.ts` so non-React callers can import this file
 * cleanly without pulling in React.
 */
export const AUTH_TOKEN_EVENT = EVENT_NAME
