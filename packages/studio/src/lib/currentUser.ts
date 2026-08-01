/**
 * Stable id stamped on every request in local and dev mode,
 * where an install has one account identified by `local-user`.
 * The display name is editable via the title-bar picker,
 * but the id never changes,
 * so audit-trail rows that captured `local-user` still resolve after a rename.
 */
export const LOCAL_USER_ID = 'local-user'

export function getCurrentUserId(): string {
  return LOCAL_USER_ID
}
