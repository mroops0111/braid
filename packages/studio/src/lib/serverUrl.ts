import { getActiveRemoteId, listRemotes, LOCAL_REMOTE_ID } from './remotes'

export const DEFAULT_SERVER_URL = 'http://localhost:4321'

// Cached at module scope so getServerUrl stays sync,
// since every API helper hits it.
// Populated by initServerUrl in Tauri runtime, null in web dev.
let cachedEmbeddedUrl: string | null = null

/**
 * Resolves the URL Studio should talk to right now.
 *   1. Active remote in Settings, when not Local
 *   2. Cached embedded sidecar URL (Tauri runtime)
 *   3. The origin this page came from, when a server served it
 *   4. Vite env / hard default (web dev)
 *
 * Falls through to Local if the active remote was removed externally.
 */
export function getServerUrl(): string {
  const activeId = getActiveRemoteId()
  if (activeId !== LOCAL_REMOTE_ID) {
    const remote = listRemotes().find(r => r.id === activeId)
    if (remote)
      return remote.url
  }
  return localServerUrl()
}

/**
 * The server behind the Local entry.
 *
 * A page a server served has to call that same server,
 * whatever hostname and port it happens to be reachable on.
 * A build-time default cannot know that,
 * and it would send a deployed Studio to a port on the visitor's own machine.
 * Vite serves Studio on its own port in development,
 * the one case where the page's origin is not the API.
 */
function localServerUrl(): string {
  if (cachedEmbeddedUrl)
    return cachedEmbeddedUrl
  if (import.meta.env.VITE_BRAID_API_URL)
    return import.meta.env.VITE_BRAID_API_URL
  if (typeof window !== 'undefined' && !import.meta.env.DEV)
    return window.location.origin
  return DEFAULT_SERVER_URL
}

export function getServerUrlFor(remoteId: string): string {
  if (remoteId === LOCAL_REMOTE_ID)
    return localServerUrl()
  const remote = listRemotes().find(r => r.id === remoteId)
  return remote?.url ?? DEFAULT_SERVER_URL
}

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * Asks the Tauri shell for its embedded server URL and caches it.
 * No-op in web contexts.
 * Called once from main.tsx before mount, so the first render sees the URL.
 */
export async function initServerUrl(): Promise<void> {
  if (!isTauriRuntime())
    return
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const info = await invoke<{ url: string }>('get_server_info')
    cachedEmbeddedUrl = info.url
  }
  catch (err) {
    console.warn('[braid] embedded server not yet reachable:', err)
  }
}
