import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function installFakeLocalStorage(): Map<string, string> {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
  })
  return store
}

// The migration runs once per module instance, so every case needs a fresh one.
async function freshStorage(): Promise<typeof import('../../src/lib/storage')> {
  vi.resetModules()
  return import('../../src/lib/storage')
}

let store: Map<string, string>

beforeEach(() => {
  store = installFakeLocalStorage()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('renamed preference keys', () => {
  it('carries a preference from its old key and drops the old one', async () => {
    store.set('braid-theme', 'dark')
    const { readStored, STORAGE_KEYS } = await freshStorage()

    expect(readStored(STORAGE_KEYS.theme)).toBe('dark')
    expect(store.has('braid-theme')).toBe(false)
  })

  it('carries every renamed key, not only the first', async () => {
    store.set('braid-locale', 'zh-Hant')
    store.set('braid-sidebar-collapsed', 'true')
    store.set('braid.answerView', 'transcript')
    const { readStored, STORAGE_KEYS } = await freshStorage()

    expect(readStored(STORAGE_KEYS.locale)).toBe('zh-Hant')
    expect(readStored(STORAGE_KEYS.sidebarCollapsed)).toBe('true')
    expect(readStored(STORAGE_KEYS.answerView)).toBe('transcript')
  })

  it('keeps what is already under the new key', async () => {
    store.set('braid-theme', 'dark')
    store.set('braid:theme', 'light')
    const { readStored, STORAGE_KEYS } = await freshStorage()

    expect(readStored(STORAGE_KEYS.theme)).toBe('light')
    expect(store.has('braid-theme')).toBe(false)
  })

  it('leaves a reader with no stored preference alone', async () => {
    const { readStored, STORAGE_KEYS } = await freshStorage()

    expect(readStored(STORAGE_KEYS.theme)).toBeNull()
    expect(store.size).toBe(0)
  })
})

describe('reading and writing', () => {
  it('reads back what it wrote', async () => {
    const { readStored, STORAGE_KEYS, writeStored } = await freshStorage()
    writeStored(STORAGE_KEYS.outputForm, 'prose')

    expect(readStored(STORAGE_KEYS.outputForm)).toBe('prose')
  })

  it('reports nothing stored where storage is barred', async () => {
    const { readStored, STORAGE_KEYS, writeStored } = await freshStorage()
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
      removeItem: () => { throw new Error('denied') },
    })

    expect(() => writeStored(STORAGE_KEYS.theme, 'dark')).not.toThrow()
    expect(readStored(STORAGE_KEYS.theme)).toBeNull()
  })
})
