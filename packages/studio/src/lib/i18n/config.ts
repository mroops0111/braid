import i18next from 'i18next'
import ICU from 'i18next-icu'
import { initReactI18next } from 'react-i18next'
import en from '@/locales/en'
import zhHant from '@/locales/zh-Hant'
import { applyDocumentLocale, FALLBACK_LOCALE, initialLocale, isLocale } from './locale'

// Catalogs are bundled, not fetched, so init completes synchronously.
// The tree renders translated on the first paint without Suspense.
void i18next
  .use(ICU)
  .use(initReactI18next)
  .init({
    resources: {
      'en': { translation: en },
      'zh-Hant': { translation: zhHant },
    },
    lng: initialLocale(),
    fallbackLng: FALLBACK_LOCALE,
    // React already escapes, and ICU owns interpolation.
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  })

applyDocumentLocale(initialLocale())
i18next.on('languageChanged', (locale) => {
  if (isLocale(locale))
    applyDocumentLocale(locale)
})

export { i18next }
