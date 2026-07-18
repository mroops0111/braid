import type { UserId as UserIdType } from '@braidhq/schema'
import type { Context, MiddlewareHandler } from 'hono'
import { UserId } from '@braidhq/schema'

declare module 'hono' {
  interface ContextVariableMap {
    userId: UserIdType
  }
}

// Header carrying the caller's userId before OAuth lands.
// Once Bearer token resolution sets userId upstream of this middleware,
// only the auth layer changes, since the rest of the codebase calls getUserId.
const HEADER = 'X-Braid-User'

/**
 * Resolve the caller's userId from `X-Braid-User`,
 * and stash it on the request context.
 * Falls back to `defaultPrincipal` when the header is absent,
 * the single-tenant install's implicit user.
 * A multi-tenant deployment passes null,
 * then an unauthenticated request leaves `userId` unset for the route to reject.
 */
export function userIdMiddleware(defaultPrincipal: UserIdType | null): MiddlewareHandler {
  return async (context, next) => {
    if (context.get('userId') === undefined) {
      const header = context.req.header(HEADER)
      const fromHeader = header && header.length > 0 ? UserId.parse(header) : null
      const resolved = fromHeader ?? defaultPrincipal
      if (resolved)
        context.set('userId', resolved)
    }
    await next()
  }
}

export function getUserId(context: Context): UserIdType {
  return context.get('userId')
}
