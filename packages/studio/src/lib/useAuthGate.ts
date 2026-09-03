import { useEffect, useState } from 'react'
import { useAuthConfig } from './useAuthConfig'
import { useAuthToken } from './useAuthToken'

interface GateLoading { status: 'loading' }
interface GateLogin { status: 'login', error?: string }
interface GateAuthenticated { status: 'authenticated' }

export type AuthGate = GateLoading | GateLogin | GateAuthenticated

/**
 * Decide whether the main app or the Login page should render.
 *
 * The logic chains through four steps.
 *   1. Read `/auth/config` to learn the server's mode,
 *      local-trust, remote, or Google-configured.
 *   2. If the server does not require auth the gate is `authenticated`,
 *      the embedded sidecar and local-install path.
 *   3. If auth is required and no Bearer token is stored,
 *      the gate is `login`.
 *      Any error stashed by the OAuth redirect is passed through,
 *      so the page surfaces it above the button.
 *   4. Otherwise the token is present and we proceed.
 *      The real validation happens when api calls fire,
 *      and a 401 from a live route is what triggers a re-login.
 *      Probing `/auth/whoami` here would cost a second round-trip per boot.
 */
export function useAuthGate(): AuthGate {
  const token = useAuthToken()
  const config = useAuthConfig()
  const [redirectError, setRedirectError] = useState<string | null>(null)

  useEffect(() => {
    const stashed = (window as { __braidAuthError?: string }).__braidAuthError
    if (stashed) {
      setRedirectError(stashed)
      delete (window as { __braidAuthError?: string }).__braidAuthError
    }
  }, [])

  if (!config)
    return { status: 'loading' }
  if (!config.requiresAuth)
    return { status: 'authenticated' }
  if (token)
    return { status: 'authenticated' }
  return redirectError ? { status: 'login', error: redirectError } : { status: 'login' }
}
