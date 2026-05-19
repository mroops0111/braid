const STORAGE_KEY = 'braid:serverUrl'

export const DEFAULT_SERVER_URL = 'http://localhost:4321'

/**
 * URL of the Tauri-spawned embedded server. Populated by
 * {@link initServerUrl} during boot; remains null in web / dev contexts.
 * Cached at module scope so {@link getServerUrl} can stay synchronous
 * (it is called from every API helper).
 */
let cachedEmbeddedUrl: string | null = null

export function getServerUrl(): string {
  // 1. Explicit user override wins. Lets Tier 2/3 users point the
  // bundled desktop app at a remote team server.
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored)
      return stored
  }
  // 2. Tauri embedded server (Tier 1).
  if (cachedEmbeddedUrl)
    return cachedEmbeddedUrl
  // 3. Build-time env var / hard default.
  return import.meta.env.VITE_BRAID_API_URL ?? DEFAULT_SERVER_URL
}

export function setServerUrl(url: string): void {
  const trimmed = url.trim().replace(/\/$/, '')
  if (trimmed)
    localStorage.setItem(STORAGE_KEY, trimmed)
  else
    localStorage.removeItem(STORAGE_KEY)
}

export function hasStoredServerUrl(): boolean {
  return typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) !== null
}

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * Ask the Tauri shell for its embedded server URL and cache it. Safe to
 * call in web contexts — it short-circuits when Tauri isn't present.
 * Called once from main.tsx before the React tree mounts so the first
 * render sees the right URL.
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
    // The Tauri side spawns the server asynchronously; if we get here
    // before it starts, fall back to the localStorage / default chain.

    console.warn('[braid] embedded server not yet reachable:', err)
  }
}
