import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { consumeOAuthRedirect, setAuthToken } from './lib/authToken'
import { initServerUrl } from './lib/serverUrl'
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
  // OAuth callback redirects land here with `#token=…` or
  // `#auth-error=…`. Consume the token before mounting so the first
  // render of `App` already sees the new session, and pass any error
  // through window.__braidAuthError so the LoginPage can surface it.
  const redirect = consumeOAuthRedirect()
  if (redirect.token)
    setAuthToken(redirect.token)
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
