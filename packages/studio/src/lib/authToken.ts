import { getActiveRemoteId, getTokenFor, setTokenFor } from './remotes'

const EVENT_NAME = 'braid:authTokenChanged'

/**
 * Bearer for the active remote. Local can hold a token too,
 * since a server with `BRAID_LOCAL_TRUST=false` still requires one,
 * even though it is localhost.
 */
export function getAuthToken(): string | null {
  return getTokenFor(getActiveRemoteId())
}

/**
 * Pass `remoteId` when minting a token mid-OAuth callback,
 * before the active remote has flipped to the new server.
 */
export function setAuthToken(token: string | null, remoteId?: string): void {
  const id = remoteId ?? getActiveRemoteId()
  setTokenFor(id, token)
  if (typeof window !== 'undefined')
    window.dispatchEvent(new CustomEvent(EVENT_NAME))
}

export function clearAuthToken(remoteId?: string): void {
  setAuthToken(null, remoteId)
}

/**
 * Whether the viewer holds a session they can leave.
 *
 * Both halves matter. With no token there is nothing to clear,
 * and on a server that does not require auth the gate never consults the
 * token, so clearing it would leave the screen exactly where it was.
 * That server is in local trust mode, where one implicit user owns
 * everything and no login ever happened.
 */
export function canSignOut(input: { token: string | null, requiresAuth: boolean }): boolean {
  return input.token !== null && input.token.length > 0 && input.requiresAuth
}

/**
 * Drains the post-OAuth redirect hash.
 *   #token=<jwt>&auth-remote=<remoteId>   on success
 *   #auth-error=<msg>                     on failure
 * `auth-remote` is absent on legacy single-server flows,
 * so the caller falls back to the active remote.
 */
export function consumeOAuthRedirect(): { token?: string, error?: string, remoteId?: string } {
  if (typeof window === 'undefined')
    return {}
  const hash = window.location.hash
  if (!hash || hash.length < 2)
    return {}
  const params = new URLSearchParams(hash.slice(1))
  const token = params.get('token') ?? undefined
  const error = params.get('auth-error') ?? undefined
  const remoteId = params.get('auth-remote') ?? undefined
  if (token || error) {
    const cleaned = window.location.pathname + window.location.search
    window.history.replaceState(null, '', cleaned)
  }
  return {
    ...(token ? { token } : {}),
    ...(error ? { error } : {}),
    ...(remoteId ? { remoteId } : {}),
  }
}

export const AUTH_TOKEN_EVENT = EVENT_NAME
