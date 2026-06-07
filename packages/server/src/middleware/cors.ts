import type { MiddlewareHandler } from 'hono'

const DEFAULT_DEV_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
]

export interface CorsOptions {
  readonly allowedOrigins?: readonly string[]
}

/**
 * Permissive CORS for Studio dev / Tier 1 (Tauri embedded server).
 * Origins default to Vite dev server ports. In production deployments,
 * pass the actual studio origin list explicitly.
 */
export function corsMiddleware(options: CorsOptions = {}): MiddlewareHandler {
  const allowed = new Set(options.allowedOrigins ?? DEFAULT_DEV_ORIGINS)
  return async (context, next) => {
    const origin = context.req.header('Origin')
    if (origin && allowed.has(origin)) {
      context.header('Access-Control-Allow-Origin', origin)
      context.header('Access-Control-Allow-Credentials', 'true')
      context.header('Vary', 'Origin')
    }
    if (context.req.method === 'OPTIONS') {
      context.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
      context.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Braid-User')
      context.header('Access-Control-Max-Age', '86400')
      return context.body(null, 204)
    }
    await next()
    return undefined
  }
}
