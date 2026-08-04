import { UserId } from './common.js'

/** A built-in non-human principal that an autonomous server component acts as. */
export interface ServiceAccount {
  readonly id: UserId
  readonly displayName: string
}

export const REACTOR_USER_ID = UserId.parse('reactor')
export const SYSTEM_USER_ID = UserId.parse('system')

/**
 * Built-in service accounts. An autonomous component acts as one of these,
 * carrying its session token so its API calls authenticate as a known,
 * non-human principal rather than an anonymous caller. Seeding, auth,
 * workspace access, and pending-item visibility all read this set,
 * so adding a new autonomous component here needs no change to any of them.
 * `system` is the generic autonomous principal, `reactor` the source-sync one.
 */
export const SERVICE_ACCOUNTS: readonly ServiceAccount[] = [
  { id: REACTOR_USER_ID, displayName: 'Reactor' },
  { id: SYSTEM_USER_ID, displayName: 'System' },
]

const SERVICE_ACCOUNT_IDS = new Set<string>(SERVICE_ACCOUNTS.map(account => account.id))

/** True when the id belongs to a built-in service account, not a human user. */
export function isServiceAccount(id: string): boolean {
  return SERVICE_ACCOUNT_IDS.has(id)
}
