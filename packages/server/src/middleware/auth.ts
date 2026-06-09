import type { MiddlewareHandler } from 'hono'
import type { SessionStore } from '../infrastructure/auth/SessionStore.js'
import process from 'node:process'
import { parseBoolEnv } from '../infrastructure/env.js'

/**
 * Routes the auth middleware never gates. Anonymous access is required
 * here, otherwise the login flow itself becomes impossible to bootstrap.
 *
 * Path prefixes (not exact match) so `/auth/google/start`,
 * `/auth/google/callback`, `/auth/whoami` all flow through without a
 * token. `/health` stays open so platform probes don't need a token.
 * `/openapi.json` matches the broad industry convention that OpenAPI
 * descriptions are publicly readable (Swagger UI, codegen, MCP gateways
 * default to fetching them without auth). It only documents shape, not
 * data, so leaking it to anonymous callers is safe.
 */
const PUBLIC_EXACT = new Set(['/openapi.json'])
const PUBLIC_PREFIXES = ['/auth/', '/health']

export interface AuthMiddlewareOptions {
  readonly sessionStore: SessionStore
  /**
   * When true, skip the Bearer check and let `userIdMiddleware`'s
   * fallback (local-user via env / header) take over. The Tauri
   * embedded sidecar sets this so the local install keeps working
   * without an OAuth round trip; a remote deployment leaves it false
   * so anonymous traffic is rejected.
   *
   * Resolution: explicit option > `BRAID_LOCAL_TRUST=true` env var.
   * Defaults to `false` when neither is set — composeFs flips this
   * to `true` for local development.
   */
  readonly localTrust?: boolean
}

// EventSource (browser SSE) cannot send custom Authorization headers, so
// for live-update endpoints we additionally accept a `?token=...` query
// parameter and treat it identically to a Bearer token. Limited to paths
// ending in `/events` so this lenient path doesn't apply to mutating routes.
function isSseEventsPath(path: string): boolean {
  return path.endsWith('/events')
}

/**
 * Pull a Bearer token off the request, or return `undefined` if the
 * header is missing / malformed. Route handlers use this to forward the
 * caller's identity to spawned skill subprocesses without re-parsing.
 */
export function extractBearerToken(context: { req: { header: (name: string) => string | undefined } }): string | undefined {
  const header = context.req.header('Authorization')
  if (!header || !header.startsWith('Bearer '))
    return undefined
  const token = header.slice('Bearer '.length).trim()
  return token.length > 0 ? token : undefined
}

export function authMiddleware(options: AuthMiddlewareOptions): MiddlewareHandler {
  const localTrust = options.localTrust ?? parseBoolEnv(process.env.BRAID_LOCAL_TRUST, false)
  return async (context, next) => {
    const path = context.req.path
    if (PUBLIC_EXACT.has(path) || PUBLIC_PREFIXES.some(prefix => path.startsWith(prefix))) {
      await next()
      return undefined
    }
    if (localTrust) {
      // The downstream `userIdMiddleware` will stamp `local-user` (or
      // honour an explicit `X-Braid-User` header for multi-persona
      // dev). The auth layer has no opinion here.
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
