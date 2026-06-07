import { getActiveRemoteId, getTokenFor, setTokenFor } from './remotes'

const EVENT_NAME = 'braid:authTokenChanged'

/**
 * Bearer for the active remote. Local can hold a token too: a
 * `pnpm dev:web` server with `BRAID_LOCAL_TRUST=false` still requires
 * one even though it's localhost.
 */
export function getAuthToken(): string | null {
  return getTokenFor(getActiveRemoteId())
}

/**
 * Pass `remoteId` when minting a token mid-OAuth callback, before the
 * active remote has flipped to the new server.
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
 * Drains the post-OAuth redirect hash:
 *   #token=<jwt>&auth-remote=<remoteId>   on success
 *   #auth-error=<msg>                     on failure
 * `auth-remote` is absent on legacy single-server flows; caller falls
 * back to the active remote.
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
