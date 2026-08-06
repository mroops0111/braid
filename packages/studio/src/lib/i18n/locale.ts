import type { Locale } from '@braidhq/schema'
import { FALLBACK_LOCALE, isLocale } from '@braidhq/schema'

// The shared cross-package locale core comes from schema.
// Studio adds only the browser-side glue below.
export { FALLBACK_LOCALE, isLocale, type Locale, type LocaleOption, SUPPORTED_LOCALES } from '@braidhq/schema'

const STORAGE_KEY = 'braid-locale'

/**
 * Locale to use on first paint.
 * Returns the user's stored pick if they have ever chosen one,
 * otherwise the closest match to the browser preference,
 * otherwise English.
 */
export function initialLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (isLocale(stored))
      return stored
  }
  catch {}
  return detectBrowserLocale()
}

function detectBrowserLocale(): Locale {
  if (typeof navigator === 'undefined')
    return FALLBACK_LOCALE
  // Any Chinese tag maps to Traditional until a Simplified catalog exists.
  if (navigator.language.toLowerCase().startsWith('zh'))
    return 'zh-Hant'
  return FALLBACK_LOCALE
}

export function writeStoredLocale(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale)
  }
  catch {}
}

/** Reflect the active locale on <html lang> for a11y and native text selection. */
export function applyDocumentLocale(locale: Locale): void {
  if (typeof document === 'undefined')
    return
  document.documentElement.lang = locale
}
