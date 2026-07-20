import type { MiddlewareHandler } from 'hono'
import type { UserRegistryFile } from '../infrastructure/users/UserRegistryFile.js'
import { ForbiddenError } from '@braidhq/core'
import { getUserId } from './userId.js'

/**
 * Server-admin gate. Composes after `authMiddleware` and `userIdMiddleware`,
 * so the resolved userId is on the context.
 * Single-tenant callers stamped as `local-user` pass through,
 * since `localTrust` provisioning seeds them with an admin serverRole.
 */
export function requireAdmin(userRegistry: UserRegistryFile): MiddlewareHandler {
  return async (context, next) => {
    const userId = getUserId(context)
    const user = await userRegistry.get(userId)
    if (!user || user.serverRole !== 'admin')
      throw new ForbiddenError('Server admin required.')
    await next()
    return undefined
  }
}
