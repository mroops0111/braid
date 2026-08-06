import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'
import { App } from './App'
import { consumeOAuthRedirect, setAuthToken } from './lib/authToken'
import { i18next } from './lib/i18n'
import { listAllRemoteIds, setActiveRemoteId } from './lib/remotes'
import { initServerUrl } from './lib/serverUrl'
import { hydrateTokens } from './lib/tokenStore'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '@fontsource-variable/noto-sans-tc'
import './styles.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10_000, refetchOnWindowFocus: false },
  },
})

const rootElement = document.getElementById('root')
if (!rootElement)
  throw new Error('Studio: #root element missing')

/**
 * Load the exact CJK glyphs the UI catalog uses before first paint,
 * so Chinese chrome renders in Noto Sans TC with no fallback swap.
 * Only runs for a CJK locale, and never blocks a Latin-locale boot.
 */
async function preloadCjkFont(): Promise<void> {
  if (typeof document === 'undefined' || i18next.language !== 'zh-Hant')
    return
  const bundle = i18next.getResourceBundle('zh-Hant', 'translation')
  if (!bundle)
    return
  try {
    await document.fonts.load('400 1em "Noto Sans TC Variable"', JSON.stringify(bundle))
  }
  catch {}
}

// Ask the Tauri shell for its embedded server URL before mounting.
// In web and dev contexts this resolves immediately as a no-op.
async function bootstrap() {
  await initServerUrl()
  // Hydrate per-remote Bearer tokens into the in-memory cache,
  // before any component renders, so the first fetchJson sees the token.
  // No-op on web, where localStorage is sync.
  // On Tauri this round-trips to the OS keyring for each known remote.
  await hydrateTokens(listAllRemoteIds())
  // OAuth callback redirects land here with `#token=<value>` or `#auth-error=<value>`.
  // Consume the token before mounting,
  // so App's first render sees the new session.
  // When the callback started from a per-remote Sign In,
  // the hash also carries `auth-remote=<remoteId>`,
  // so we store under that remote and switch active to it.
  const redirect = consumeOAuthRedirect()
  if (redirect.token) {
    if (redirect.remoteId) {
      setAuthToken(redirect.token, redirect.remoteId)
      setActiveRemoteId(redirect.remoteId)
    }
    else {
      setAuthToken(redirect.token)
    }
  }
  if (redirect.error)
    (window as { __braidAuthError?: string }).__braidAuthError = redirect.error

  await preloadCjkFont()

  createRoot(rootElement!).render(
    <StrictMode>
      <I18nextProvider i18n={i18next}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </I18nextProvider>
    </StrictMode>,
  )
}

void bootstrap()
