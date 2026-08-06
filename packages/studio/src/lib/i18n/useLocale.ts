import { useTranslation } from 'react-i18next'
import { FALLBACK_LOCALE, isLocale, type Locale, writeStoredLocale } from './locale'

/**
 * Read and switch the active locale.
 * Shaped to mirror useTheme so settings surfaces read the same.
 * Switching persists the choice and re-renders every translated subtree.
 */
export function useLocale(): { locale: Locale, setLocale: (next: Locale) => void } {
  const { i18n } = useTranslation()

  function setLocale(next: Locale): void {
    writeStoredLocale(next)
    void i18n.changeLanguage(next)
  }

  const locale = isLocale(i18n.language) ? i18n.language : FALLBACK_LOCALE
  return { locale, setLocale }
}
