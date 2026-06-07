import { useEffect, useState } from 'react'
import { AUTH_TOKEN_EVENT, getAuthToken } from './authToken'

/**
 * Subscribe to changes in the Braid Bearer token. Re-renders the
 * caller on `setAuthToken` / `clearAuthToken` from anywhere in the
 * app — used by the top-level auth gate in `App.tsx` to re-evaluate
 * when a logout button fires.
 */
export function useAuthToken(): string | null {
  const [value, setValue] = useState<string | null>(() => getAuthToken())
  useEffect(() => {
    const handler = (): void => setValue(getAuthToken())
    window.addEventListener(AUTH_TOKEN_EVENT, handler)
    return () => window.removeEventListener(AUTH_TOKEN_EVENT, handler)
  }, [])
  return value
}
