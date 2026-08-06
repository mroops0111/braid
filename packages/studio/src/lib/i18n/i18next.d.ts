import type en from '@/locales/en'
import 'i18next'

// Type the t() keys off the English catalog so every key is checked,
// and missing keys in other locales fail to compile.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: { translation: typeof en }
  }
}
