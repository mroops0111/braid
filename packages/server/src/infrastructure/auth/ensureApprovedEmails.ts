import type { UserRegistryFile } from '../users/UserRegistryFile.js'
import type { AccessPolicy } from './AccessPolicy.js'

/**
 * Back-fills `approvedEmails` from existing users.json entries.
 *
 * Without this, accounts created before the approvedEmails feature
 * existed (or while the invite-was-consumed bug was live) would be
 * stuck behind Gate-1 even though they hold a valid user record. Every
 * email we see in the registry must be persistently approved going
 * forward; this is the one-shot reconciliation.
 *
 * Idempotent: AccessPolicy.approveEmail no-ops when the email is
 * already there, so re-running on every boot is cheap.
 */
export async function ensureApprovedEmails(
  userRegistry: UserRegistryFile,
  accessPolicy: AccessPolicy,
): Promise<void> {
  const users = await userRegistry.list()
  for (const user of users) {
    if (user.email)
      await accessPolicy.approveEmail(user.email)
  }
}
