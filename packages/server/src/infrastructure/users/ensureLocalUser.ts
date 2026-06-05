import type { Timestamp } from '@braidhq/schema'
import type { UserRegistryFile } from './UserRegistryFile.js'
import { userInfo } from 'node:os'
import process from 'node:process'
import { UserId } from '@braidhq/schema'

/**
 * Branded id reserved for the single implicit account on a local install.
 * `userIdMiddleware` resolves to this value when no `X-Braid-User` header
 * is sent (the embedded sidecar path), so the registry MUST have a row
 * for it or `getMe` and audit-trail reads break.
 */
export const LOCAL_USER_ID = UserId.parse('local-user')

/**
 * Idempotently ensure the `local-user` row exists. Pre-existing rows
 * are left untouched (the user may have renamed themselves, set an
 * email, etc.). Default `displayName` comes from the OS account.
 */
export async function ensureLocalUser(registry: UserRegistryFile): Promise<void> {
  const existing = await registry.get(LOCAL_USER_ID)
  if (existing)
    return

  await registry.create({
    id: LOCAL_USER_ID,
    displayName: safeOsUsername(),
    serverRole: 'admin',
    canCreateWorkspace: true,
    createdAt: new Date().toISOString() as Timestamp,
  })
}

function safeOsUsername(): string {
  try {
    const info = userInfo()
    if (info.username && info.username.length > 0)
      return info.username
  }
  catch {
    // Some sandboxed environments throw on userInfo(); fall through.
  }
  return process.env.USER ?? process.env.USERNAME ?? 'local'
}
