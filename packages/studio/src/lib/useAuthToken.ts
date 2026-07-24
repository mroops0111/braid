import { useEffect, useState } from 'react'
import { AUTH_TOKEN_EVENT, getAuthToken } from './authToken'

// Re-renders on setAuthToken or clearAuthToken from anywhere in the app,
// so the top-level auth gate in App.tsx re-evaluates when logout fires.
export function useAuthToken(): string | null {
  const [value, setValue] = useState<string | null>(() => getAuthToken())
  useEffect(() => {
    const handler = (): void => setValue(getAuthToken())
    window.addEventListener(AUTH_TOKEN_EVENT, handler)
    return () => window.removeEventListener(AUTH_TOKEN_EVENT, handler)
  }, [])
  return value
}
