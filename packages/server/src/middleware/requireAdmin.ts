import type { MiddlewareHandler } from 'hono'
import type { UserRegistryFile } from '../infrastructure/users/UserRegistryFile.js'
import { getUserId } from './userId.js'

/**
 * Server-admin gate. Composes after `authMiddleware` + `userIdMiddleware`
 * so the resolved userId is on the context. Local-trust callers stamped
 * as `local-user` pass through because `ensureLocalUser` seeds them
 * with `serverRole: 'admin'`.
 */
export function requireAdmin(userRegistry: UserRegistryFile): MiddlewareHandler {
  return async (context, next) => {
    const userId = getUserId(context)
    const user = await userRegistry.get(userId)
    if (!user || user.serverRole !== 'admin') {
      return context.json(
        {
          type: 'about:blank',
          title: 'Forbidden',
          status: 403,
          detail: 'Server admin required.',
        },
        403,
        { 'Content-Type': 'application/problem+json' },
      )
    }
    await next()
    return undefined
  }
}
