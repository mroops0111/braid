import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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
 * with `#token=<value>` or `#auth-error=<value>`.
 * The hash is consumed by `consumeOAuthRedirect` in App.tsx,
 * before this page is rendered.
 */
export function LoginPage({ initialError }: LoginPageProps) {
  const { t } = useTranslation()
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
      // The server names its provider, so Studio never assumes Google.
      const provider = config?.loginProvider
      if (!provider)
        throw new Error('This server has no sign-in configured.')
      const { authorizationUrl } = await api.startSignIn(provider, returnTo)
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
          <h1 className="text-xl font-semibold">{t('shell.login.title')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('shell.login.description')}
          </p>
        </header>
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
        {isLoading
          ? <p className="text-center text-xs text-muted-foreground">{t('shell.login.checkingServer')}</p>
          : config?.loginProvider
            ? (
                <Button
                  type="button"
                  size="lg"
                  className="w-full"
                  onClick={startSignIn}
                  disabled={starting}
                >
                  {starting
                    ? t('shell.login.redirecting')
                    // Google is Braid's own client, so the button can name it.
                    // Any other provider is the deployment's to name, and
                    // guessing would put the wrong logo on the door.
                    : config.loginProvider === 'google'
                      ? t('shell.login.signInWithGoogle')
                      : t('shell.login.signIn')}
                </Button>
              )
            : (
                <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  {t('shell.login.notConfigured')}
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
