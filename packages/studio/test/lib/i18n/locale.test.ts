import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyDocumentLocale, initialLocale, isLocale, writeStoredLocale } from '../../../src/lib/i18n/locale'

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

function setNavigatorLanguage(language: string | undefined): void {
  if (language === undefined)
    vi.stubGlobal('navigator', undefined)
  else
    vi.stubGlobal('navigator', { language })
}

beforeEach(() => {
  installFakeLocalStorage()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isLocale', () => {
  it('accepts the supported locales', () => {
    expect(isLocale('en')).toBe(true)
    expect(isLocale('zh-Hant')).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isLocale('zh-Hans')).toBe(false)
    expect(isLocale('fr')).toBe(false)
    expect(isLocale(undefined)).toBe(false)
    expect(isLocale(42)).toBe(false)
  })
})

describe('initialLocale', () => {
  it('returns the stored pick when it is a supported locale', () => {
    setNavigatorLanguage('en-US')
    writeStoredLocale('zh-Hant')
    expect(initialLocale()).toBe('zh-Hant')
  })

  it('ignores a stored value that is no longer supported', () => {
    localStorage.setItem('braid-locale', 'zh-Hans')
    setNavigatorLanguage('en-US')
    expect(initialLocale()).toBe('en')
  })

  it('maps any Chinese browser tag to Traditional when nothing is stored', () => {
    setNavigatorLanguage('zh-TW')
    expect(initialLocale()).toBe('zh-Hant')
  })

  it('falls back to English for an unsupported browser tag', () => {
    setNavigatorLanguage('de-DE')
    expect(initialLocale()).toBe('en')
  })

  it('falls back to English when navigator is unavailable', () => {
    setNavigatorLanguage(undefined)
    expect(initialLocale()).toBe('en')
  })
})

describe('writeStoredLocale', () => {
  it('persists the locale under the storage key', () => {
    writeStoredLocale('zh-Hant')
    expect(localStorage.getItem('braid-locale')).toBe('zh-Hant')
  })
})

describe('applyDocumentLocale', () => {
  it('writes the locale onto the document element lang', () => {
    const documentElement = { lang: '' }
    vi.stubGlobal('document', { documentElement })
    applyDocumentLocale('zh-Hant')
    expect(documentElement.lang).toBe('zh-Hant')
  })
})
