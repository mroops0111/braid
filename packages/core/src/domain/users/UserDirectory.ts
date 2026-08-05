import type { UserId, UserKind } from '@braidhq/schema'

/**
 * Read-only lookup of a userId's human-facing fields.
 * Used by the commit pipeline to snapshot `displayName` and `email`,
 * so `git log` shows real names instead of opaque `usr-` placeholders.
 *
 * Returns `null` when the userId is unknown.
 * Bootstrap / source-sync authors intentionally don't resolve,
 * e.g. `braid-skill` or `braid-bootstrap`,
 * and the git layer falls back to its synthetic author for those.
 */
export interface UserDirectory {
  resolve: (userId: UserId) => Promise<UserAuthor | null>
}

export interface UserAuthor {
  readonly displayName: string
  readonly email?: string
  // Snapshotted onto proposals and tickets at submit time,
  // so the HITL views classify an autonomous owner without a read-time lookup.
  readonly kind?: UserKind
}

/** Drop-in directory that always returns null. Used by tests and the in-memory composition. */
export const noopUserDirectory: UserDirectory = {
  resolve: async () => null,
}
