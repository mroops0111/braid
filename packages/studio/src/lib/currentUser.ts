/**
 * Stable userId stamped on every request in local / dev mode. Local
 * installs have exactly one account, identified by `local-user`. The
 * user's display name (separately) is editable via the title-bar
 * picker, but the id itself never changes — audit-trail rows that
 * captured `local-user` still resolve to the same row after a rename.
 *
 * Phase B (Google OAuth) will introduce a `getAuthToken()` next to
 * this for remote servers; the header swap from `X-Braid-User` to
 * `Authorization: Bearer` happens in `fetchJson`.
 */
export const LOCAL_USER_ID = 'local-user'

export function getCurrentUserId(): string {
  return LOCAL_USER_ID
}
