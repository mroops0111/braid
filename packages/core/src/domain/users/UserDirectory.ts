import type { UserId } from '@braidhq/schema'

/**
 * Read-only lookup of a userId's human-facing fields. Used by the
 * commit pipeline to snapshot `displayName` / `email` into the git
 * author so `git log` shows real names instead of opaque `usr-…`
 * placeholders.
 *
 * Returns `null` when the userId is unknown — bootstrap / source-sync
 * authors (e.g. `braid-skill`, `braid-bootstrap`) intentionally don't
 * resolve, and the git layer falls back to its synthetic author for
 * those.
 */
export interface UserDirectory {
  resolve: (userId: UserId) => Promise<UserAuthor | null>
}

export interface UserAuthor {
  readonly displayName: string
  readonly email?: string
}

/** Drop-in directory that always returns null. Used by tests and the in-memory composition. */
export const noopUserDirectory: UserDirectory = {
  resolve: async () => null,
}
