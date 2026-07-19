import type { Timestamp, UserId } from '@braidhq/schema'
import type { AccessPolicy } from './infrastructure/auth/AccessPolicy.js'
import type { UserRegistryFile } from './infrastructure/users/UserRegistryFile.js'
import { userInfo } from 'node:os'
import process from 'node:process'
import { UserId as UserIdSchema } from '@braidhq/schema'

export const LOCAL_USER_ID = UserIdSchema.parse('local-user')

export interface AuthContext {
  readonly userRegistry: UserRegistryFile
  readonly accessPolicy: AccessPolicy
}

/**
 * How a deployment resolves identity.
 * The one axis that separates a trusted local install,
 * from an authenticated remote server.
 *
 * `defaultPrincipal` is the implicit user for an unauthenticated request,
 * and the owner a workspace falls back to when it has none.
 * It is null when real authentication is required,
 * then an unauthenticated request and an ownerless workspace are errors,
 * never silently attributed to a shared account.
 *
 * Stateless behaviour behind an interface, so a const object per mode,
 * the idiomatic strategy form when there is no constructor dependency.
 */
export interface AuthMode {
  readonly defaultPrincipal: UserId | null
  // Seed the host state this mode needs, called once at boot.
  provision: (context: AuthContext) => Promise<void>
}

// A local desktop or sidecar. One implicit user owns everything,
// so provision seeds that `local-user` admin account, idempotently.
export const localTrust: AuthMode = {
  defaultPrincipal: LOCAL_USER_ID,
  async provision({ userRegistry }) {
    if (await userRegistry.get(LOCAL_USER_ID))
      return
    await userRegistry.create({
      id: LOCAL_USER_ID,
      displayName: osUsername(),
      serverRole: 'admin',
      createdAt: new Date().toISOString() as Timestamp,
    })
  },
}

// A remote server. Real users authenticate against an allowlist,
// so provision back-fills `approvedEmails` from the roster, idempotently.
export const authenticated: AuthMode = {
  defaultPrincipal: null,
  async provision({ userRegistry, accessPolicy }) {
    for (const user of await userRegistry.list()) {
      if (user.email)
        await accessPolicy.approveEmail(user.email)
    }
  },
}

// Default display name from the OS account.
// Some sandboxed environments throw on userInfo(), so fall through.
function osUsername(): string {
  try {
    const info = userInfo()
    if (info.username && info.username.length > 0)
      return info.username
  }
  catch {
    // userInfo is not available here.
  }
  return process.env.USER ?? process.env.USERNAME ?? 'local'
}
