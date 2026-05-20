import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
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
  createRoot(rootElement!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  )
}

void bootstrap()
