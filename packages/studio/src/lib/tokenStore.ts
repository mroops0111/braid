import { invoke } from '@tauri-apps/api/core'

/**
 * Per-remote Bearer token store.
 *
 * Web build: tokens live in localStorage under `braid:tokens`.
 * Tauri build: tokens live in the OS keyring (Keychain/Credential
 * Manager/libsecret) via Rust commands; an in-memory cache mirrors them
 * so reads stay synchronous for `fetchJson` and friends.
 *
 * Callers go through `getToken` / `setToken` rather than touching
 * localStorage directly. `hydrate()` is awaited once at boot to load
 * the keyring snapshot into cache (no-op on web).
 */

const LS_KEY = 'braid:tokens'

const cache = new Map<string, string>()
let hydrated = false

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function readLocalStorageTokens(): Record<string, string> {
  if (typeof localStorage === 'undefined')
    return {}
  const raw = localStorage.getItem(LS_KEY)
  if (!raw)
    return {}
  try {
    return JSON.parse(raw) as Record<string, string>
  }
  catch {
    return {}
  }
}

function writeLocalStorageTokens(map: Record<string, string>): void {
  if (typeof localStorage === 'undefined')
    return
  if (Object.keys(map).length === 0)
    localStorage.removeItem(LS_KEY)
  else
    localStorage.setItem(LS_KEY, JSON.stringify(map))
}

/**
 * Populate the in-memory cache. On web this reads localStorage; on
 * Tauri this iterates a known set of remote IDs (LOCAL + caller-supplied)
 * against the keyring and migrates any leftover localStorage entries.
 */
export async function hydrateTokens(remoteIds: string[]): Promise<void> {
  if (hydrated)
    return
  hydrated = true

  if (!isTauri()) {
    const map = readLocalStorageTokens()
    for (const [id, token] of Object.entries(map))
      cache.set(id, token)
    return
  }

  // Tauri: migrate any localStorage holdover into keyring, then clear.
  const lsMap = readLocalStorageTokens()
  for (const [id, token] of Object.entries(lsMap)) {
    try {
      await invoke('keyring_set_token', { remoteId: id, token })
      cache.set(id, token)
    }
    catch (err) {
      console.warn('[tokenStore] migrate failed for', id, err)
    }
  }
  if (Object.keys(lsMap).length > 0)
    writeLocalStorageTokens({})

  // Pull anything else from keyring that we didn't see in localStorage.
  for (const id of remoteIds) {
    if (cache.has(id))
      continue
    try {
      const token = await invoke<string | null>('keyring_get_token', { remoteId: id })
      if (token)
        cache.set(id, token)
    }
    catch (err) {
      console.warn('[tokenStore] read failed for', id, err)
    }
  }
}

export function getToken(remoteId: string): string | null {
  return cache.get(remoteId) ?? null
}

export function setToken(remoteId: string, token: string | null): void {
  if (token && token.length > 0)
    cache.set(remoteId, token)
  else
    cache.delete(remoteId)

  if (!isTauri()) {
    const map = readLocalStorageTokens()
    if (token && token.length > 0)
      map[remoteId] = token
    else
      delete map[remoteId]
    writeLocalStorageTokens(map)
    return
  }

  // Fire-and-forget keyring write; the in-memory cache already reflects
  // the new state so subsequent sync reads are correct. A failed persist
  // means the user re-authenticates after restart, which is recoverable.
  if (token && token.length > 0) {
    void invoke('keyring_set_token', { remoteId, token }).catch((err) => {
      console.warn('[tokenStore] keyring_set_token failed', err)
    })
  }
  else {
    void invoke('keyring_delete_token', { remoteId }).catch((err) => {
      console.warn('[tokenStore] keyring_delete_token failed', err)
    })
  }
}
