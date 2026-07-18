import type { UserId } from '@braidhq/schema'
import type { MiddlewareHandler } from 'hono'
import type { SessionStore } from '../infrastructure/auth/SessionStore.js'

// Routes the auth middleware never gates,
// since bootstrapping the login flow needs anonymous access.
// `/openapi.json` follows the convention that OpenAPI reads publicly,
// honored by Swagger UI, codegen, and MCP gateways.
// It documents shape and not data, so exposing it to anonymous callers is safe.
const PUBLIC_EXACT = new Set(['/openapi.json'])
// Each `/webhooks/<provider>/` prefix is anonymous,
// because the provider authenticates via a per-source HMAC,
// checked inside the handler rather than via a Bearer token.
// Listing providers one by one, rather than the broad `/webhooks/`,
// keeps a future admin or metrics webhook from inheriting the bypass.
const PUBLIC_PREFIXES = ['/auth/', '/health', '/webhooks/github/']

export interface AuthMiddlewareOptions {
  readonly sessionStore: SessionStore
  /**
   * The single-tenant default principal, or null for a multi-tenant server.
   * When set, the Bearer check is skipped,
   * the downstream `userIdMiddleware` resolves the caller.
   * When null, every non-public route requires a valid Bearer token.
   */
  readonly defaultPrincipal: UserId | null
}

// EventSource (browser SSE) cannot send custom Authorization headers,
// so live-update endpoints also accept a `token` query parameter,
// treated as a Bearer token.
// Limited to paths ending in `/events`,
// so the lenient path never applies to mutating routes.
function isSseEventsPath(path: string): boolean {
  return path.endsWith('/events')
}

/**
 * Pull a Bearer token off the request,
 * returning `undefined` when the header is missing or malformed.
 * Route handlers use this to forward the caller's identity,
 * reaching spawned skill subprocesses without reparsing.
 */
export function extractBearerToken(context: { req: { header: (name: string) => string | undefined } }): string | undefined {
  const header = context.req.header('Authorization')
  if (!header || !header.startsWith('Bearer '))
    return undefined
  const token = header.slice('Bearer '.length).trim()
  return token.length > 0 ? token : undefined
}

export function authMiddleware(options: AuthMiddlewareOptions): MiddlewareHandler {
  return async (context, next) => {
    const path = context.req.path
    if (PUBLIC_EXACT.has(path) || PUBLIC_PREFIXES.some(prefix => path.startsWith(prefix))) {
      await next()
      return undefined
    }
    if (options.defaultPrincipal !== null) {
      // Single-tenant, so skip the Bearer check.
      // `userIdMiddleware` stamps the default principal downstream,
      // or an explicit `X-Braid-User` header for multi-persona dev.
      await next()
      return undefined
    }
    const header = context.req.header('Authorization')
    let token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null
    // Fall back to a query-param token for SSE endpoints only.
    if (!token && isSseEventsPath(path)) {
      const queryToken = context.req.query('token')
      if (queryToken)
        token = queryToken
    }
    if (!token) {
      return context.json(
        {
          type: 'about:blank',
          title: 'Unauthorized',
          status: 401,
          detail: 'Missing or invalid Authorization header. Sign in to continue.',
        },
        401,
        { 'Content-Type': 'application/problem+json' },
      )
    }
    const session = await options.sessionStore.resolve(token)
    if (!session) {
      return context.json(
        {
          type: 'about:blank',
          title: 'Unauthorized',
          status: 401,
          detail: 'Session expired or revoked. Sign in again.',
        },
        401,
        { 'Content-Type': 'application/problem+json' },
      )
    }
    context.set('userId', session.userId)
    await next()
    return undefined
  }
}
