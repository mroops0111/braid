import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { api, ApiError } from '@/lib/api'

interface LoginPageProps {
  /**
   * Surfaced when the callback redirect lands with `#auth-error=…`.
   * Shown above the Sign-in button,
   * so the user knows why they are back on the Login page.
   */
  initialError?: string | null
}

/**
 * Gate shown when the remote server requires authentication,
 * and the Studio has no Bearer token.
 *
 * Single-button flow. Click "Sign in with Google",
 * the server returns a consent URL, and the browser navigates there.
 * Google calls the server callback, which redirects back here,
 * with `#token=…` or `#auth-error=…`.
 * The hash is consumed by `consumeOAuthRedirect` in App.tsx,
 * before this page is rendered.
 */
export function LoginPage({ initialError }: LoginPageProps) {
  const [error, setError] = useState<string | null>(initialError ?? null)
  const [starting, setStarting] = useState(false)
  const { data: config, isLoading } = useQuery({
    queryKey: ['auth', 'config'],
    queryFn: () => api.authConfig(),
    staleTime: 5 * 60 * 1000,
  })

  async function startSignIn() {
    setStarting(true)
    setError(null)
    try {
      const returnTo = window.location.origin + window.location.pathname
      const { authorizationUrl } = await api.startGoogleSignIn(returnTo)
      window.location.href = authorizationUrl
    }
    catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err))
      setStarting(false)
    }
  }

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-background px-6 text-foreground">
      <div className="w-full max-w-sm space-y-6">
        <header className="space-y-2 text-center">
          <h1 className="text-xl font-semibold">Sign In to Braid</h1>
          <p className="text-sm text-muted-foreground">
            This server requires authentication. Sign in with a Google
            account whose email is on the allowlist or has an invite.
          </p>
        </header>
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
        {isLoading
          ? <p className="text-center text-xs text-muted-foreground">Checking server…</p>
          : config?.googleEnabled
            ? (
                <Button
                  type="button"
                  size="lg"
                  className="w-full"
                  onClick={startSignIn}
                  disabled={starting}
                >
                  {starting ? 'Redirecting…' : 'Sign In with Google'}
                </Button>
              )
            : (
                <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  Google Sign-in isn't configured on this server. Ask the
                  admin to set
                  {' '}
                  <code className="font-mono">BRAID_GOOGLE_CLIENT_ID</code>
                  {' / '}
                  <code className="font-mono">BRAID_GOOGLE_CLIENT_SECRET</code>
                  .
                </div>
              )}
      </div>
    </div>
  )
}
