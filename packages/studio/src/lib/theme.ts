import { useEffect, useState } from 'react'
import { readStored, STORAGE_KEYS, writeStored } from './storage.js'

export type Theme = 'light' | 'dark'

function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark'
}

/**
 * Theme to apply on first paint.
 * Returns the user's stored pick if they have ever clicked the toggle,
 * otherwise the OS preference.
 * Once the user picks a theme it sticks,
 * and no longer follows OS day-night changes.
 * That is the trade for a simple two-state toggle without a `system` mode.
 */
function initialTheme(): Theme {
  const stored = readStored(STORAGE_KEYS.theme)
  if (isTheme(stored))
    return stored
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    return 'dark'
  return 'light'
}

function writeStoredTheme(theme: Theme): void {
  writeStored(STORAGE_KEYS.theme, theme)
}

/** Toggle the `dark` class on <html> so Tailwind's `dark:` variants pick up. */
function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined')
    return
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

export function useTheme(): { theme: Theme, setTheme: (t: Theme) => void } {
  const [theme, setThemeState] = useState<Theme>(initialTheme)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  function setTheme(next: Theme): void {
    writeStoredTheme(next)
    setThemeState(next)
  }

  return { theme, setTheme }
}
