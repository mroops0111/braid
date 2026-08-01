import { useEffect, useState } from 'react'
import { getToken as readToken, setToken as writeToken } from './tokenStore'

/**
 * Storage layout (localStorage, per-origin):
 *   braid:remotes         RemoteServer[]   saved remote entries
 *   braid:activeRemoteId  string           which remote is current
 *
 * Per-remote Bearer tokens live in `tokenStore` (localStorage on web,
 * OS keyring on Tauri). `LOCAL_REMOTE_ID` is synthesised on read,
 * never stored, so the user can't delete the embedded sidecar entry.
 */
export interface RemoteServer {
  id: string
  name: string
  url: string
  addedAt: string
}

const KEY_REMOTES = 'braid:remotes'
const KEY_ACTIVE = 'braid:activeRemoteId'
const LEGACY_SERVER_URL = 'braid:serverUrl'
const LEGACY_AUTH_TOKEN = 'braid:authToken'

export const LOCAL_REMOTE_ID = 'local'
const EVENT_NAME = 'braid:remotesChanged'

function emitChange(): void {
  if (typeof window !== 'undefined')
    window.dispatchEvent(new CustomEvent(EVENT_NAME))
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof localStorage === 'undefined')
    return fallback
  const raw = localStorage.getItem(key)
  if (!raw)
    return fallback
  try {
    return JSON.parse(raw) as T
  }
  catch {
    return fallback
  }
}

function writeJson<T>(key: string, value: T): void {
  if (typeof localStorage === 'undefined')
    return
  localStorage.setItem(key, JSON.stringify(value))
}

/**
 * Idempotent migration to the per-remote layout,
 * from the old single-server keys `braid:serverUrl` and `braid:authToken`.
 * Without this an upgrade silently bounces the user to Login.
 *
 * Legacy keys are left in place so a downgrade still works,
 * and a later major version can sweep them up.
 */
let legacyMigrationDone = false

function maybeMigrateLegacy(): void {
  if (typeof localStorage === 'undefined' || legacyMigrationDone)
    return
  legacyMigrationDone = true
  const legacyToken = localStorage.getItem(LEGACY_AUTH_TOKEN)
  if (legacyToken && readToken(LOCAL_REMOTE_ID) == null)
    writeToken(LOCAL_REMOTE_ID, legacyToken)
  const remotes = readJson<RemoteServer[]>(KEY_REMOTES, [])
  const legacyUrl = localStorage.getItem(LEGACY_SERVER_URL)
  if (legacyUrl && remotes.length === 0) {
    const id = `r-${Date.now().toString(36)}`
    const migrated: RemoteServer = {
      id,
      name: new URL(legacyUrl).host,
      url: legacyUrl.replace(/\/$/, ''),
      addedAt: new Date().toISOString(),
    }
    writeJson(KEY_REMOTES, [migrated])
    if (legacyToken)
      writeToken(id, legacyToken)
    localStorage.setItem(KEY_ACTIVE, id)
  }
}

export function listRemotes(): RemoteServer[] {
  maybeMigrateLegacy()
  return readJson<RemoteServer[]>(KEY_REMOTES, [])
}

export function getActiveRemoteId(): string {
  if (typeof localStorage === 'undefined')
    return LOCAL_REMOTE_ID
  return localStorage.getItem(KEY_ACTIVE) ?? LOCAL_REMOTE_ID
}

export function setActiveRemoteId(id: string): void {
  if (typeof localStorage === 'undefined')
    return
  localStorage.setItem(KEY_ACTIVE, id)
  emitChange()
}

export function addRemote(input: { name: string, url: string }): RemoteServer {
  const remotes = listRemotes()
  const normalisedUrl = input.url.trim().replace(/\/$/, '')
  const remote: RemoteServer = {
    id: `r-${Date.now().toString(36)}`,
    name: input.name.trim(),
    url: normalisedUrl,
    addedAt: new Date().toISOString(),
  }
  writeJson(KEY_REMOTES, [...remotes, remote])
  emitChange()
  return remote
}

export function removeRemote(id: string): void {
  if (id === LOCAL_REMOTE_ID)
    return
  const remotes = listRemotes().filter(r => r.id !== id)
  writeJson(KEY_REMOTES, remotes)
  writeToken(id, null)
  if (getActiveRemoteId() === id)
    setActiveRemoteId(LOCAL_REMOTE_ID)
  emitChange()
}

export function getTokenFor(remoteId: string): string | null {
  maybeMigrateLegacy()
  return readToken(remoteId)
}

export function setTokenFor(remoteId: string, token: string | null): void {
  writeToken(remoteId, token)
  emitChange()
}

export function listAllRemoteIds(): string[] {
  const remotes = readJson<RemoteServer[]>(KEY_REMOTES, [])
  return [LOCAL_REMOTE_ID, ...remotes.map(r => r.id)]
}

export function useRemotes(): RemoteServer[] {
  const [value, setValue] = useState<RemoteServer[]>(() => listRemotes())
  useEffect(() => {
    const handler = (): void => setValue(listRemotes())
    window.addEventListener(EVENT_NAME, handler)
    return () => window.removeEventListener(EVENT_NAME, handler)
  }, [])
  return value
}

export function useActiveRemoteId(): string {
  const [value, setValue] = useState<string>(() => getActiveRemoteId())
  useEffect(() => {
    const handler = (): void => setValue(getActiveRemoteId())
    window.addEventListener(EVENT_NAME, handler)
    return () => window.removeEventListener(EVENT_NAME, handler)
  }, [])
  return value
}
