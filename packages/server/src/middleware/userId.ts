import type { UserId as UserIdType } from '@braidhq/schema'
import type { Context, MiddlewareHandler } from 'hono'
import { UserId } from '@braidhq/schema'

declare module 'hono' {
  interface ContextVariableMap {
    userId: UserIdType
  }
}

/**
 * Header name carrying the caller's userId in Phase A (pre-auth).
 * Phase B (Google OAuth) will replace this with `Authorization: Bearer`
 * token resolution and `c.set('userId', ...)` upstream of this middleware;
 * the rest of the codebase only ever calls `getUserId(c)`, so the
 * substitution stays local to the auth layer.
 */
const HEADER = 'X-Braid-User'

const DEFAULT_USER_ID = UserId.parse('local-user')

/**
 * Resolve the caller's userId from `X-Braid-User` (Phase A) and stash
 * it on the request context. Falls back to `local-user` when the
 * header is absent, preserving local-only behaviour for the embedded
 * sidecar that doesn't bother sending one.
 */
export const userIdMiddleware: MiddlewareHandler = async (context, next) => {
  if (context.get('userId') === undefined) {
    const header = context.req.header(HEADER)
    context.set('userId', header && header.length > 0 ? UserId.parse(header) : DEFAULT_USER_ID)
  }
  await next()
}

export function getUserId(context: Context): UserIdType {
  return context.get('userId')
}
