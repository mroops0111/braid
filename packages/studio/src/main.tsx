import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { consumeOAuthRedirect, setAuthToken } from './lib/authToken'
import { listAllRemoteIds, setActiveRemoteId } from './lib/remotes'
import { initServerUrl } from './lib/serverUrl'
import { hydrateTokens } from './lib/tokenStore'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import './styles.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10_000, refetchOnWindowFocus: false },
  },
})

const rootElement = document.getElementById('root')
if (!rootElement)
  throw new Error('Studio: #root element missing')

// Ask the Tauri shell for its embedded server URL before mounting; in
// web / dev contexts this resolves immediately as a no-op.
async function bootstrap() {
  await initServerUrl()
  // Hydrate per-remote Bearer tokens into the in-memory cache before
  // any component renders, so the first fetchJson sees the right token.
  // No-op on web (localStorage is sync); on Tauri this round-trips to
  // the OS keyring for each known remote.
  await hydrateTokens(listAllRemoteIds())
  // OAuth callback redirects land here with `#token=…` or `#auth-error=…`.
  // Consume the token before mounting so App's first render sees the new
  // session. When the callback was started from a per-remote Sign In, the
  // hash also carries `auth-remote=<remoteId>` so we both store under that
  // remote and switch active to it.
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

  createRoot(rootElement!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  )
}

void bootstrap()
