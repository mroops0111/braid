import type { Workspace, WorkspaceService } from '@braidhq/core'
import type { UserId } from '@braidhq/schema'
import type { Context, Hono as HonoType } from 'hono'
import type { GitHubOAuth } from '../infrastructure/oauth/GitHubOAuth.js'
import type { GoogleOAuth } from '../infrastructure/oauth/GoogleOAuth.js'
import type { SecretStore } from '../infrastructure/secrets/SecretStore.js'
import type { UserRegistryFile } from '../infrastructure/users/UserRegistryFile.js'
import type { WorkspaceRegistryFile } from '../infrastructure/workspace/WorkspaceRegistryFile.js'
import { ForbiddenError, NotFoundError } from '@braidhq/core'
import { WorkspaceId } from '@braidhq/schema'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { createOAuthState, createPkceVerifier } from '../infrastructure/oauth/GoogleOAuth.js'
import { getUserId } from '../middleware/auth.js'
import { defaultPermissionRegistry, resolveViewer } from '../policy/index.js'

const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'

const StartBodySchema = z.object({
  workspaceId: z.string().min(1),
  sourceId: z.string().min(1),
})

/** The workspace member who authorised a source connection. */
export interface ConnectedBy {
  readonly userId: string
  readonly displayName: string
}

interface PendingFlow {
  readonly workspaceId: string
  readonly sourceId: string
  readonly connectedBy?: ConnectedBy
  // Set only when the provider uses PKCE, GitHub does not.
  readonly codeVerifier?: string
  readonly createdAt: number
}

/**
 * One connectable OAuth provider. It owns the two flow-specific steps,
 * begin and complete, plus the labels the router needs.
 * Adding a provider means adding one descriptor to `providersOf`,
 * both routers register it without change.
 * `begin` is absent when the provider's server env is unset,
 * so its start route answers 503.
 */
interface OAuthProvider {
  readonly id: 'google' | 'github'
  readonly label: string
  readonly namespace: string
  readonly notConfigured: string
  readonly begin?: (state: string) => { authorizationUrl: string, codeVerifier?: string }
  readonly complete?: (flow: PendingFlow, code: string) => Promise<object>
}

/**
 * In-process store of pending OAuth flows, keyed by the state token.
 * The start and callback routers mount at different prefixes,
 * so they share one instance,
 * and a flow opened by `start` is resolved by `callback`.
 * A flow is short-lived, one browser round-trip, and a restart cancels it.
 * SaaS deployments should swap this for a shared store.
 */
export class OAuthFlowStore {
  private readonly pending = new Map<string, PendingFlow>()

  put(state: string, flow: PendingFlow): void {
    this.pending.set(state, flow)
    this.sweep()
  }

  take(state: string): PendingFlow | undefined {
    const flow = this.pending.get(state)
    this.pending.delete(state)
    return flow
  }

  private sweep(): void {
    const cutoff = Date.now() - 10 * 60 * 1000
    for (const [state, flow] of this.pending) {
      if (flow.createdAt < cutoff)
        this.pending.delete(state)
    }
  }
}

export interface OAuthRouterDeps {
  readonly secretStore: SecretStore
  readonly flowStore: OAuthFlowStore
  readonly google?: GoogleOAuth
  readonly github?: GitHubOAuth
  // Used by the start router to gate an existing workspace,
  // and to record who connected. Absent in in-memory tests, which skip the gate.
  readonly userRegistry?: UserRegistryFile
  readonly workspaceService?: WorkspaceService
  readonly workspaceRegistry?: WorkspaceRegistryFile
}

function providersOf(deps: OAuthRouterDeps): readonly OAuthProvider[] {
  return [
    {
      id: 'google',
      label: 'Google',
      namespace: 'oauth-google',
      notConfigured: 'Google OAuth is not configured on this server. Set BRAID_GOOGLE_CLIENT_ID + BRAID_GOOGLE_CLIENT_SECRET (and BRAID_GOOGLE_REDIRECT_URI if not the default) and restart.',
      ...(deps.google
        ? {
            begin: (state: string) => {
              const codeVerifier = createPkceVerifier()
              return { authorizationUrl: deps.google!.buildAuthorizationUrl({ scopes: [DRIVE_READONLY_SCOPE], state, codeVerifier }), codeVerifier }
            },
            complete: (flow: PendingFlow, code: string) => {
              if (!flow.codeVerifier)
                throw new Error('Google flow is missing its PKCE verifier.')
              return deps.google!.exchangeCode({ code, codeVerifier: flow.codeVerifier })
            },
          }
        : {}),
    },
    {
      id: 'github',
      label: 'GitHub',
      namespace: 'oauth-github',
      notConfigured: 'GitHub OAuth is not configured on this server. Set BRAID_GITHUB_CLIENT_ID + BRAID_GITHUB_CLIENT_SECRET (and BRAID_GITHUB_REDIRECT_URI if not the default) and restart.',
      ...(deps.github
        ? {
            begin: (state: string) => ({ authorizationUrl: deps.github!.buildAuthorizationUrl({ state }) }),
            complete: (_flow: PendingFlow, code: string) => deps.github!.exchangeCode({ code }),
          }
        : {}),
    },
  ]
}

/**
 * Source-connection start routes. `workspace.write` is owner-only,
 * so only an owner connects or reconnects a source on an existing workspace,
 * and the authorising member is recorded as `connectedBy`.
 * A not-yet-scaffolded workspace is allowed,
 * since the Wizard connects a source before it creates the workspace,
 * and the caller becomes its owner.
 */
export function createOAuthStartRouter(deps: OAuthRouterDeps): HonoType {
  const router = new Hono()
  for (const provider of providersOf(deps)) {
    router.post(`/${provider.id}/start`, zValidator('json', StartBodySchema), async (context) => {
      if (!provider.begin)
        return context.json({ error: provider.notConfigured }, 503)
      const { workspaceId, sourceId } = context.req.valid('json')
      const connectedBy = await authoriseConnect(deps, workspaceId, getUserId(context))
      const state = createOAuthState()
      const started = provider.begin(state)
      deps.flowStore.put(state, pendingFlow(workspaceId, sourceId, connectedBy, started.codeVerifier))
      return context.json({ authorizationUrl: started.authorizationUrl })
    })
  }
  return router
}

/**
 * Gate a connect on `workspace.write` when the workspace exists,
 * allow it before scaffold, and return who is connecting.
 * Returns undefined in the in-memory composition,
 * which wires no user or workspace registry and stays open,
 * matching how the other workspace routes behave there.
 */
async function authoriseConnect(deps: OAuthRouterDeps, workspaceId: string, userId: UserId): Promise<ConnectedBy | undefined> {
  if (!deps.userRegistry || !deps.workspaceService || !deps.workspaceRegistry)
    return undefined
  const user = await deps.userRegistry.get(userId)
  if (!user)
    throw new ForbiddenError(`Unknown user "${userId}".`)
  const workspace = await findWorkspaceOrUndefined(deps.workspaceService, workspaceId)
  if (workspace) {
    const member = await deps.workspaceRegistry.getMember(workspace.rootPath, userId)
    if (!defaultPermissionRegistry.can('workspace.write', resolveViewer(user, member)))
      throw new ForbiddenError(`Only an owner can connect a source on workspace "${workspaceId}".`)
  }
  return { userId: user.id, displayName: user.displayName }
}

async function findWorkspaceOrUndefined(service: WorkspaceService, workspaceId: string): Promise<Workspace | undefined> {
  try {
    return await service.findById(WorkspaceId.parse(workspaceId))
  }
  catch (error) {
    if (error instanceof NotFoundError)
      return undefined
    throw error
  }
}

/**
 * OAuth callback routes, mounted at `/oauth`,
 * so the redirect URI stays one fixed path per provider,
 * which is what the OAuth app registers.
 * The state token carries the flow back to its workspace and source.
 */
export function createOAuthCallbackRouter(deps: OAuthRouterDeps): HonoType {
  const router = new Hono()
  for (const provider of providersOf(deps)) {
    router.get(`/${provider.id}/callback`, async (context) => {
      const parsed = parseCallback(context, provider)
      if (!parsed.ok)
        return parsed.response
      if (!provider.complete)
        return context.html(renderCallbackPage({ ok: false, provider, message: 'OAuth not configured.' }), 503)
      const flow = deps.flowStore.take(parsed.state)
      if (!flow)
        return context.html(renderCallbackPage({ ok: false, provider, message: 'State token not recognised (probably expired or already used).' }), 400)
      try {
        const tokens = await provider.complete(flow, parsed.code)
        await persistTokens(deps.secretStore, provider, flow, tokens)
        return context.html(renderCallbackPage({ ok: true, provider, message: 'Connected. You can close this window.' }))
      }
      catch (err) {
        return context.html(renderCallbackPage({ ok: false, provider, message: err instanceof Error ? err.message : String(err) }), 500)
      }
    })
  }
  return router
}

function pendingFlow(workspaceId: string, sourceId: string, connectedBy: ConnectedBy | undefined, codeVerifier: string | undefined): PendingFlow {
  return {
    workspaceId,
    sourceId,
    createdAt: Date.now(),
    ...(connectedBy ? { connectedBy } : {}),
    ...(codeVerifier ? { codeVerifier } : {}),
  }
}

type ParsedCallback =
  | { ok: true, state: string, code: string }
  | { ok: false, response: Response }

function parseCallback(context: Context, provider: OAuthProvider): ParsedCallback {
  const error = context.req.query('error')
  if (error)
    return { ok: false, response: context.html(renderCallbackPage({ ok: false, provider, message: `${provider.label} returned: ${error}` }), 400) }
  const state = context.req.query('state')
  const code = context.req.query('code')
  if (!state || !code)
    return { ok: false, response: context.html(renderCallbackPage({ ok: false, provider, message: 'Missing state or code query parameter.' }), 400) }
  return { ok: true, state, code }
}

async function persistTokens(store: SecretStore, provider: OAuthProvider, flow: PendingFlow, tokens: object): Promise<void> {
  await store.write(provider.namespace, `${flow.workspaceId}--${flow.sourceId}`, {
    ...tokens,
    connectedAt: new Date().toISOString(),
    ...(flow.connectedBy ? { connectedBy: flow.connectedBy } : {}),
  })
}

function renderCallbackPage(input: { ok: boolean, provider: OAuthProvider, message: string }): string {
  // Tiny self-contained HTML. Tells the popup opener and closes itself.
  // Inline style so the page works without any asset pipeline.
  const colour = input.ok ? '#16a34a' : '#dc2626'
  const status = input.ok ? 'success' : 'error'
  const heading = input.ok ? `Connected to ${input.provider.label}` : 'Authorization failed'
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
  <h1>${heading}</h1>
  <p>${escapeHtml(input.message)}</p>
</div>
<script>
  try { window.opener?.postMessage({ source: 'braid-oauth', provider: ${JSON.stringify(input.provider.id)}, status: ${JSON.stringify(status)} }, '*'); } catch (_e) {}
  setTimeout(() => { try { window.close(); } catch (_e) {} }, 1500);
</script>
</body></html>`
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[ch]!)
}
