/**
 * Every key Studio holds in the browser, named once.
 *
 * Three conventions had grown up side by side (`braid-`, `braid.`, `braid:`),
 * each spelled inline at the one place that read it,
 * so nothing said what the set was and a new preference picked a fourth.
 * Naming them here makes the set readable,
 * and `braid:` wins because the keys that cannot be renamed already use it.
 */
export const STORAGE_KEYS = {
  theme: 'braid:theme',
  locale: 'braid:locale',
  sidebarCollapsed: 'braid:sidebarCollapsed',
  /** Which audience a reader reads an answer as, their own habit either way. */
  answerView: 'braid:answerView',
  /**
   * Which form to ask for when starting a run, and nothing else.
   *
   * Never consulted to display a run that already exists.
   * The form a run was produced in is a fact recorded on the run,
   * so a conversation lent to somebody else reads the way its author made it,
   * rather than the way its reader happens to prefer.
   */
  outputForm: 'braid:outputForm',
  tokens: 'braid:tokens',
  remotes: 'braid:remotes',
  activeRemoteId: 'braid:activeRemoteId',
} as const

export type StorageKey = typeof STORAGE_KEYS[keyof typeof STORAGE_KEYS]

/**
 * Preference keys that were renamed, old name to new.
 *
 * Tokens and remotes are absent on purpose.
 * Renaming those would sign the reader out,
 * and they already carry the convention the rest are moving to.
 */
const RENAMED: ReadonlyArray<readonly [string, StorageKey]> = [
  ['braid-theme', STORAGE_KEYS.theme],
  ['braid-locale', STORAGE_KEYS.locale],
  ['braid-sidebar-collapsed', STORAGE_KEYS.sidebarCollapsed],
  ['braid.answerView', STORAGE_KEYS.answerView],
]

let migrated = false

/**
 * Move any preference still under its old key, then drop the old key.
 *
 * Called before every read rather than once at startup,
 * because theme and locale are read during first paint,
 * and an import order that put a read before a startup hook
 * would silently reset them.
 *
 * A value already under the new key wins,
 * so a second run of this is a no-op rather than a revert.
 */
function ensureMigrated(): void {
  if (migrated || typeof localStorage === 'undefined')
    return
  migrated = true
  for (const [old, next] of RENAMED) {
    try {
      const carried = localStorage.getItem(old)
      if (carried === null)
        continue
      if (localStorage.getItem(next) === null)
        localStorage.setItem(next, carried)
      localStorage.removeItem(old)
    }
    catch {}
  }
}

/** What is stored under `key`, or null when nothing is, or storage is barred. */
export function readStored(key: StorageKey): string | null {
  ensureMigrated()
  try {
    return localStorage.getItem(key)
  }
  catch {
    return null
  }
}

/** Store `value` under `key`, doing nothing where storage is barred. */
export function writeStored(key: StorageKey, value: string): void {
  ensureMigrated()
  try {
    localStorage.setItem(key, value)
  }
  catch {}
}
