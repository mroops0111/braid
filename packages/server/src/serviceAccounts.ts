import type { Timestamp, UserId as UserIdType } from '@braidhq/schema'
import type { UserRegistryFile } from './infrastructure/users/UserRegistryFile.js'

// Re-exported from core, where the reactor attributes its runs to it,
// so the seeded account and the recorded author cannot drift apart.
export { REACTOR_USER_ID } from '@braidhq/core'

/**
 * Upsert a service account, idempotently. It is an admin,
 * so its calls clear the workspace gate via the admin-to-owner rule.
 * kind=service marks it non-human, and that kind rides onto its proposals,
 * so the HITL views classify its pending without a read-time registry lookup.
 * Each autonomous component seeds its own by calling this.
 */
export async function ensureServiceAccount(userRegistry: UserRegistryFile, id: UserIdType, displayName: string): Promise<void> {
  const existing = await userRegistry.get(id)
  if (existing) {
    if (existing.kind !== 'service' || existing.serverRole !== 'admin')
      await userRegistry.update(id, { kind: 'service', serverRole: 'admin' })
    return
  }
  await userRegistry.create({
    id,
    displayName,
    serverRole: 'admin',
    kind: 'service',
    createdAt: new Date().toISOString() as Timestamp,
  })
}
