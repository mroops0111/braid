import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'braid-theme'

function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark'
}

/**
 * Theme to apply on first paint. Returns the user's stored pick if they
 * have ever clicked the toggle; otherwise falls back to the OS
 * preference. Once the user picks a theme it sticks and no longer
 * follows OS day / night changes. That's the trade for a simple
 * two-state toggle without a `system` mode.
 */
function initialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (isTheme(stored))
      return stored
  }
  catch {}
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    return 'dark'
  return 'light'
}

function writeStoredTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  }
  catch {}
}

/** Toggle the `dark` class on <html> so Tailwind's `dark:` variants pick up. */
function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined')
    return
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

/**
 * React hook that reads / persists the theme preference and keeps the
 * `<html class="dark">` toggle in sync. Two states only: light and dark.
 */
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
