import { z } from 'zod'

/**
 * Locales the product ships translations for. Closed set, so an enum.
 * The Studio UI locale and plugin-declared localized text draw from it.
 */
export const Locale = z.enum(['en', 'zh-Hant'])
export type Locale = z.infer<typeof Locale>

export const FALLBACK_LOCALE: Locale = 'en'

/** A supported locale plus its own endonym, shown in a language picker. */
export interface LocaleOption {
  code: Locale
  label: string
}

export const SUPPORTED_LOCALES = [
  { code: 'en', label: 'English' },
  { code: 'zh-Hant', label: '繁體中文' },
] as const satisfies readonly LocaleOption[]

export function isLocale(value: unknown): value is Locale {
  return Locale.safeParse(value).success
}

/**
 * Display text with optional per-locale variants.
 * A bare string applies to all locales.
 * A partial map translates only the terms a plugin wants.
 */
export type LocalizedText = string | Partial<Record<Locale, string>>

/** Build a LocalizedText zod schema, reusing the same constraints for each variant. */
export function localizedText(value: z.ZodString = z.string()): z.ZodType<LocalizedText> {
  return z.union([value, z.partialRecord(Locale, value)])
}

/** Resolve localized text for a locale, falling back when a variant is missing. */
export function localize(text: LocalizedText, locale: Locale, fallback: Locale = FALLBACK_LOCALE): string {
  if (typeof text === 'string')
    return text
  return text[locale] ?? text[fallback] ?? Object.values(text)[0] ?? ''
}
