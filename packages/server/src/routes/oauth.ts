import type { GoogleOAuth, TokenSet } from '../infrastructure/oauth/GoogleOAuth.js'
import type { SecretStore } from '../infrastructure/secrets/SecretStore.js'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { createOAuthState, createPkceVerifier } from '../infrastructure/oauth/GoogleOAuth.js'

const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'

const StartBodySchema = z.object({
  workspaceId: z.string().min(1),
  sourceId: z.string().min(1),
})

export interface OAuthRouterDeps {
  readonly secretStore: SecretStore
  readonly google?: GoogleOAuth
}

interface PendingFlow {
  readonly workspaceId: string
  readonly sourceId: string
  readonly codeVerifier: string
  readonly createdAt: number
}

/**
 * OAuth routes for source-loader providers that need user consent.
 * `POST /oauth/google/start` returns an authorizationUrl.
 * `GET /oauth/google/callback` returns an HTML page that closes the popup.
 *
 * Pending state is kept in process memory. The flow is short-lived,
 * a single browser round-trip, and a server restart cancels it,
 * acceptable for a local desktop or single-user install.
 * SaaS deployments should swap `pending` for a shared store.
 */
export function createOAuthRouter(deps: OAuthRouterDeps): Hono {
  const router = new Hono()
  const pending = new Map<string, PendingFlow>()

  router.post('/google/start', zValidator('json', StartBodySchema), async (context) => {
    if (!deps.google) {
      return context.json({
        error: 'Google OAuth is not configured on this server. Set BRAID_GOOGLE_CLIENT_ID + BRAID_GOOGLE_CLIENT_SECRET (and BRAID_GOOGLE_REDIRECT_URI if not the default) and restart.',
      }, 503)
    }
    const { workspaceId, sourceId } = context.req.valid('json')
    const state = createOAuthState()
    const codeVerifier = createPkceVerifier()
    pending.set(state, { workspaceId, sourceId, codeVerifier, createdAt: Date.now() })
    sweepStale(pending)
    const authorizationUrl = deps.google.buildAuthorizationUrl({
      scopes: [DRIVE_READONLY_SCOPE],
      state,
      codeVerifier,
    })
    return context.json({ authorizationUrl })
  })

  router.get('/google/callback', async (context) => {
    const state = context.req.query('state')
    const code = context.req.query('code')
    const error = context.req.query('error')
    if (error)
      return context.html(renderCallbackPage({ ok: false, message: `Google returned: ${error}` }), 400)
    if (!state || !code)
      return context.html(renderCallbackPage({ ok: false, message: 'Missing state or code query parameter.' }), 400)
    if (!deps.google)
      return context.html(renderCallbackPage({ ok: false, message: 'OAuth not configured.' }), 503)

    const flow = pending.get(state)
    pending.delete(state)
    if (!flow)
      return context.html(renderCallbackPage({ ok: false, message: 'State token not recognised (probably expired or already used).' }), 400)

    try {
      const tokens = await deps.google.exchangeCode({ code, codeVerifier: flow.codeVerifier })
      await persistTokens(deps.secretStore, flow.workspaceId, flow.sourceId, tokens)
      return context.html(renderCallbackPage({ ok: true, message: 'Connected. You can close this window.' }))
    }
    catch (err) {
      return context.html(renderCallbackPage({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      }), 500)
    }
  })

  return router
}

async function persistTokens(
  store: SecretStore,
  workspaceId: string,
  sourceId: string,
  tokens: TokenSet,
): Promise<void> {
  await store.write('oauth-google', `${workspaceId}--${sourceId}`, tokens)
}

function sweepStale(pending: Map<string, PendingFlow>): void {
  const cutoff = Date.now() - 10 * 60 * 1000
  for (const [state, flow] of pending) {
    if (flow.createdAt < cutoff)
      pending.delete(state)
  }
}

function renderCallbackPage(input: { ok: boolean, message: string }): string {
  // Tiny self-contained HTML. Tells the popup opener and closes itself.
  // Inline style so the page works without any asset pipeline.
  const colour = input.ok ? '#16a34a' : '#dc2626'
  const status = input.ok ? 'success' : 'error'
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Braid OAuth</title>
<style>
  body { font: 14px -apple-system, system-ui, sans-serif; background: #fafafa; color: #1a1a1a; margin: 0; padding: 3rem; }
  .card { max-width: 28rem; margin: 0 auto; background: white; border-radius: 8px; padding: 2rem; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  h1 { font-size: 1rem; margin: 0 0 0.5rem; color: ${colour}; }
  p { margin: 0; color: #525252; line-height: 1.5; }
</style>
</head><body>
<div class="card">
  <h1>${status === 'success' ? 'Connected to Google' : 'Authorization failed'}</h1>
  <p>${escapeHtml(input.message)}</p>
</div>
<script>
  try { window.opener?.postMessage({ source: 'braid-oauth', provider: 'google', status: ${JSON.stringify(status)} }, '*'); } catch (_e) {}
  setTimeout(() => { try { window.close(); } catch (_e) {} }, 1500);
</script>
</body></html>`
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[ch]!)
}
