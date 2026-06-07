import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from './api'
import { useAuthToken } from './useAuthToken'

interface GateLoading { status: 'loading' }
interface GateLogin { status: 'login', error?: string }
interface GateAuthenticated { status: 'authenticated' }

export type AuthGate = GateLoading | GateLogin | GateAuthenticated

/**
 * Decide whether the main app or the Login page should render.
 *
 * The logic chains:
 *   1. Read `/auth/config` to learn the server's mode (local-trust /
 *      remote / Google-configured).
 *   2. If the server doesn't require auth → `authenticated` (the
 *      embedded sidecar / local install path).
 *   3. If auth is required AND no Bearer token in localStorage →
 *      `login`. Any error message stashed by the OAuth redirect is
 *      passed through to the page so it surfaces above the button.
 *   4. Otherwise the token is present and we proceed; the actual
 *      validation happens when api calls fire — a 401 from a real
 *      route is what triggers the user to re-login. (We could probe
 *      `/auth/whoami` here, but that's a second round-trip per boot.)
 */
export function useAuthGate(): AuthGate {
  const token = useAuthToken()
  const { data: config, isLoading } = useQuery({
    queryKey: ['auth', 'config'],
    queryFn: () => api.authConfig(),
    staleTime: 5 * 60 * 1000,
  })
  const [redirectError, setRedirectError] = useState<string | null>(null)

  useEffect(() => {
    const stashed = (window as { __braidAuthError?: string }).__braidAuthError
    if (stashed) {
      setRedirectError(stashed)
      delete (window as { __braidAuthError?: string }).__braidAuthError
    }
  }, [])

  if (isLoading)
    return { status: 'loading' }
  if (!config)
    return { status: 'loading' }
  if (!config.requiresAuth)
    return { status: 'authenticated' }
  if (token)
    return { status: 'authenticated' }
  return redirectError ? { status: 'login', error: redirectError } : { status: 'login' }
}
