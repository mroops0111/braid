import type { UserId as UserIdType } from '@braidhq/schema'
import type { Context, MiddlewareHandler } from 'hono'
import type { SessionStore } from '../infrastructure/auth/SessionStore.js'
import { UnauthorizedError } from '@braidhq/core'
import { UserId } from '@braidhq/schema'

declare module 'hono' {
  interface ContextVariableMap {
    userId: UserIdType
  }
}

// Routes the auth middleware never gates,
// since bootstrapping the login flow needs anonymous access.
// `/openapi.json` follows the convention that OpenAPI reads publicly,
// honored by Swagger UI, codegen, and MCP gateways.
// It documents shape and not data, so exposing it to anonymous callers is safe.
const PUBLIC_EXACT_PATHS = new Set(['/openapi.json'])
// Each `/webhooks/<provider>/` prefix is anonymous,
// because the provider authenticates via a per-source HMAC,
// checked inside the handler rather than via a Bearer token.
// Listing providers one by one, rather than the broad `/webhooks/`,
// keeps a future admin or metrics webhook from inheriting the bypass.
const PUBLIC_PATH_PREFIXES = ['/auth/', '/health', '/webhooks/github/']

// Any OAuth provider callback is anonymous. It is a browser redirect,
// so it carries no Bearer,
// its `state` token validated against the pending-flow store is its auth.
// The pattern matches the callback of every provider,
// so a new one inherits the bypass without editing here,
// while the start route stays gated so its owner check runs.
const PUBLIC_PATH_PATTERNS = [/^\/oauth\/[^/]+\/callback/]

// Header naming the caller under local trust, a dev and multi-persona convenience.
// Read only when auth is not enforced, never on an authenticated deployment,
// so it can never impersonate a caller behind real auth.
const USER_HEADER = 'X-Braid-User'

export interface AuthMiddlewareOptions {
  // Resolves Bearer sessions. Required whenever `requireAuth` is true.
  readonly sessionStore?: SessionStore
  // Whether a caller must present a valid Bearer token.
  readonly requireAuth: boolean
  // The implicit caller under local trust, or null when there is none.
  readonly defaultPrincipal: UserIdType | null
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

/**
 * Establish the caller's identity, and gate when auth is enforced.
 * The single place a request's `userId` is resolved.
 *
 * Under local trust, identity comes from `X-Braid-User`, else the default
 * principal, on every path so public routes like `/auth/whoami` see the caller.
 * Nothing is rejected.
 *
 * When auth is enforced, identity comes only from a valid Bearer session, and a
 * missing or invalid token on a non-public route is a 401. The header is never
 * read here, so it cannot impersonate an authenticated caller.
 */
export function authMiddleware(options: AuthMiddlewareOptions): MiddlewareHandler {
  return async (context, next) => {
    const path = context.req.path

    if (!options.requireAuth) {
      // A presented, valid Bearer session wins even under local trust,
      // so an internal caller like the reactor is identified as its service account.
      // Studio under local trust sends no Bearer, so this never shadows it.
      const token = extractBearerToken(context)
      const session = token ? await options.sessionStore?.resolve(token) : undefined
      if (session) {
        context.set('userId', session.userId)
        await next()
        return undefined
      }
      const header = context.req.header(USER_HEADER)
      const fromHeader = header && header.length > 0 ? UserId.parse(header) : null
      const resolved = fromHeader ?? options.defaultPrincipal
      if (resolved)
        context.set('userId', resolved)
      await next()
      return undefined
    }

    // Public routes bootstrap the login flow, so pass them through ungated,
    // and without reading the header, they must never carry a caller.
    if (PUBLIC_EXACT_PATHS.has(path) || PUBLIC_PATH_PREFIXES.some(prefix => path.startsWith(prefix)) || PUBLIC_PATH_PATTERNS.some(pattern => pattern.test(path))) {
      await next()
      return undefined
    }

    let token = extractBearerToken(context)
    if (!token && isSseEventsPath(path))
      token = context.req.query('token') || undefined
    if (!token)
      throw new UnauthorizedError('Missing or invalid Authorization header. Sign in to continue.')
    // The composition root always wires sessionStore alongside requireAuth.
    const session = await options.sessionStore!.resolve(token)
    if (!session)
      throw new UnauthorizedError('Session expired or revoked. Sign in again.')
    context.set('userId', session.userId)
    await next()
    return undefined
  }
}

export function getUserId(context: Context): UserIdType {
  return context.get('userId')
}
