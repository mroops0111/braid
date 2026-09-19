import type { StorageKey } from './storage.js'
import { useCallback, useSyncExternalStore } from 'react'
import { readStored, writeStored } from './storage.js'

// One set for every key, since a preference changes rarely
// and telling a handful of components to re-read costs less than
// keeping a subscriber list per key correct.
const listeners = new Set<() => void>()

/**
 * A preference stored with the reader, shared live across components.
 *
 * Changing it in one place shows up in every other place at once,
 * which a plain `useState` beside `localStorage` does not do,
 * and which matters wherever the same choice is offered twice.
 *
 * `resolve` turns what was stored into a value this render may use.
 * It runs on every render rather than being memoised,
 * so a caller can resolve against something that changes,
 * such as the audiences an ontology currently declares.
 * Returning a fallback there is what keeps a stale stored value
 * from showing an empty surface.
 */
export function usePreference<T extends string>(
  key: StorageKey,
  resolve: (stored: string | null) => T,
): [T, (next: T) => void] {
  const stored = useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
    () => readStored(key),
    // Server render holds no browser storage, so every reader starts unset.
    () => null,
  )

  const set = useCallback((next: T) => {
    writeStored(key, next)
    for (const listener of listeners)
      listener()
  }, [key])

  return [resolve(stored), set]
}
