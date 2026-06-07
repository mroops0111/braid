import { beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeStorage {
  store: Map<string, string>
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
  clear: () => void
}

function installFakeLocalStorage(): FakeStorage {
  const store = new Map<string, string>()
  const fake: FakeStorage = {
    store,
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => { store.set(key, value) },
    removeItem: (key) => { store.delete(key) },
    clear: () => { store.clear() },
  }
  vi.stubGlobal('localStorage', fake)
  return fake
}

function setTauri(enabled: boolean): void {
  if (enabled)
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} })
  else
    vi.stubGlobal('window', {})
}

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invokeMock(cmd, args),
}))

async function importFresh(): Promise<typeof import('../../src/lib/tokenStore')> {
  vi.resetModules()
  return import('../../src/lib/tokenStore')
}

describe('tokenStore (web mode)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    invokeMock.mockReset()
    installFakeLocalStorage()
    setTauri(false)
  })

  it('hydrates the in-memory cache from existing localStorage', async () => {
    const storage = installFakeLocalStorage()
    storage.setItem('braid:tokens', JSON.stringify({ 'local': 'eyJabc', 'r-foo': 'eyJdef' }))

    const { getToken, hydrateTokens } = await importFresh()
    await hydrateTokens(['local', 'r-foo'])

    expect(getToken('local')).toBe('eyJabc')
    expect(getToken('r-foo')).toBe('eyJdef')
  })

  it('set persists to localStorage and reads back through the cache', async () => {
    const storage = installFakeLocalStorage()
    const { getToken, hydrateTokens, setToken } = await importFresh()
    await hydrateTokens(['local'])

    setToken('local', 'new-token')

    expect(getToken('local')).toBe('new-token')
    const persisted = JSON.parse(storage.getItem('braid:tokens') ?? '{}')
    expect(persisted).toEqual({ local: 'new-token' })
  })

  it('set with null clears the localStorage entry', async () => {
    const storage = installFakeLocalStorage()
    storage.setItem('braid:tokens', JSON.stringify({ local: 'old' }))
    const { getToken, hydrateTokens, setToken } = await importFresh()
    await hydrateTokens(['local'])

    setToken('local', null)

    expect(getToken('local')).toBeNull()
    expect(storage.getItem('braid:tokens')).toBeNull()
  })

  it('hydrate is idempotent: a second call is a no-op even with new ids', async () => {
    const storage = installFakeLocalStorage()
    storage.setItem('braid:tokens', JSON.stringify({ local: 'first' }))
    const { getToken, hydrateTokens } = await importFresh()
    await hydrateTokens(['local'])

    // Mutating localStorage after hydrate should not affect cached state.
    storage.setItem('braid:tokens', JSON.stringify({ local: 'second' }))
    await hydrateTokens(['local'])

    expect(getToken('local')).toBe('first')
  })
})

describe('tokenStore (Tauri mode)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    invokeMock.mockReset()
    installFakeLocalStorage()
    setTauri(true)
  })

  it('hydrate migrates leftover localStorage tokens into the keyring and clears them', async () => {
    const storage = installFakeLocalStorage()
    setTauri(true)
    storage.setItem('braid:tokens', JSON.stringify({ 'local': 'migrated', 'r-foo': 'also-migrated' }))
    invokeMock.mockResolvedValue(undefined)

    const { getToken, hydrateTokens } = await importFresh()
    await hydrateTokens(['local', 'r-foo'])

    expect(invokeMock).toHaveBeenCalledWith('keyring_set_token', { remoteId: 'local', token: 'migrated' })
    expect(invokeMock).toHaveBeenCalledWith('keyring_set_token', { remoteId: 'r-foo', token: 'also-migrated' })
    expect(storage.getItem('braid:tokens')).toBeNull()
    expect(getToken('local')).toBe('migrated')
    expect(getToken('r-foo')).toBe('also-migrated')
  })

  it('hydrate falls back to keyring_get_token for remote ids absent from localStorage', async () => {
    setTauri(true)
    invokeMock.mockImplementation(async (cmd: string, args: { remoteId: string }) => {
      if (cmd === 'keyring_get_token' && args.remoteId === 'local')
        return 'keyring-token'
      return null
    })

    const { getToken, hydrateTokens } = await importFresh()
    await hydrateTokens(['local'])

    expect(invokeMock).toHaveBeenCalledWith('keyring_get_token', { remoteId: 'local' })
    expect(getToken('local')).toBe('keyring-token')
  })

  it('set fires keyring_set_token without blocking the caller', async () => {
    setTauri(true)
    invokeMock.mockResolvedValue(undefined)
    const { getToken, hydrateTokens, setToken } = await importFresh()
    await hydrateTokens(['local'])
    invokeMock.mockClear()

    setToken('local', 'fresh')

    expect(getToken('local')).toBe('fresh')
    expect(invokeMock).toHaveBeenCalledWith('keyring_set_token', { remoteId: 'local', token: 'fresh' })
  })

  it('set with null fires keyring_delete_token', async () => {
    setTauri(true)
    invokeMock.mockResolvedValue(undefined)
    const { getToken, hydrateTokens, setToken } = await importFresh()
    await hydrateTokens(['local'])
    invokeMock.mockClear()

    setToken('local', null)

    expect(getToken('local')).toBeNull()
    expect(invokeMock).toHaveBeenCalledWith('keyring_delete_token', { remoteId: 'local' })
  })

  it('set never writes the token to localStorage in Tauri mode', async () => {
    setTauri(true)
    const storage = installFakeLocalStorage()
    invokeMock.mockResolvedValue(undefined)
    const { hydrateTokens, setToken } = await importFresh()
    await hydrateTokens(['local'])

    setToken('local', 'never-on-disk-as-plaintext')

    expect(storage.getItem('braid:tokens')).toBeNull()
  })
})
