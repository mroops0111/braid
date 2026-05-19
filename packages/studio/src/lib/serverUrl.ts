const STORAGE_KEY = 'braid:serverUrl'

export const DEFAULT_SERVER_URL = 'http://localhost:4321'

export function getServerUrl(): string {
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored)
      return stored
  }
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
