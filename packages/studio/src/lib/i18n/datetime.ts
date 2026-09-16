import { useTranslation } from 'react-i18next'

export type DateInput = string | number | Date

export interface LocaleFormatters {
  formatDate: (value: DateInput) => string
  formatTime: (value: DateInput) => string
  formatDateTime: (value: DateInput) => string
  formatRelativeTime: (value: DateInput) => string
  formatRelativeTimeShort: (value: DateInput) => string
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60],
  ['month', 30 * 24 * 60 * 60],
  ['week', 7 * 24 * 60 * 60],
  ['day', 24 * 60 * 60],
  ['hour', 60 * 60],
  ['minute', 60],
  ['second', 1],
]

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value)
}

export function formatDateIn(locale: string, value: DateInput): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(toDate(value))
}

export function formatTimeIn(locale: string, value: DateInput): string {
  return new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(toDate(value))
}

export function formatDateTimeIn(locale: string, value: DateInput): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(toDate(value))
}

function relativeIn(locale: string, value: DateInput, options: Intl.RelativeTimeFormatOptions): string {
  const deltaSeconds = (toDate(value).getTime() - Date.now()) / 1000
  const magnitude = Math.abs(deltaSeconds)
  const format = new Intl.RelativeTimeFormat(locale, options)
  for (const [unit, unitSeconds] of RELATIVE_UNITS) {
    if (magnitude >= unitSeconds)
      return format.format(Math.round(deltaSeconds / unitSeconds), unit)
  }
  return format.format(0, 'second')
}

export function formatRelativeTimeIn(locale: string, value: DateInput): string {
  return relativeIn(locale, value, { numeric: 'auto' })
}

/**
 * The same instant for a metadata column: `3w ago` rather than `3 weeks ago`.
 * Narrow keeps it on one line at any width the column is given,
 * and always-numeric keeps `yesterday` from breaking the shape of the column.
 */
export function formatRelativeTimeShortIn(locale: string, value: DateInput): string {
  return relativeIn(locale, value, { numeric: 'always', style: 'narrow' })
}

/**
 * Locale-bound date and relative-time formatters.
 * Reading through useTranslation re-runs the caller on a language change,
 * so every rendered timestamp follows the active locale.
 */
export function useLocaleFormat(): LocaleFormatters {
  const { i18n } = useTranslation()
  const locale = i18n.language

  return {
    formatDate: value => formatDateIn(locale, value),
    formatTime: value => formatTimeIn(locale, value),
    formatDateTime: value => formatDateTimeIn(locale, value),
    formatRelativeTime: value => formatRelativeTimeIn(locale, value),
    formatRelativeTimeShort: value => formatRelativeTimeShortIn(locale, value),
  }
}
