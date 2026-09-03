import type { Clock } from '@braidhq/core'
import type { Timestamp, UserId } from '@braidhq/schema'
import type { Context } from 'hono'
import type { AccessPolicy } from '../infrastructure/auth/AccessPolicy.js'
import type { LoginProfile, LoginProvider } from '../infrastructure/auth/LoginProvider.js'
import type { SessionStore } from '../infrastructure/auth/SessionStore.js'
import type { UserRegistryFile } from '../infrastructure/users/UserRegistryFile.js'
import { newUserId, NotFoundError, ValidationError } from '@braidhq/core'
import { Hono } from 'hono'
import { z } from 'zod'
import { createOAuthState, createPkceVerifier } from '../infrastructure/oauth/GoogleOAuth.js'

interface PendingFlow {
  codeVerifier: string
  returnTo: string
  createdAt: number
}

const PENDING_TTL_MS = 10 * 60 * 1000

export interface AuthRouterDeps {
  clock: Clock
  sessionStore: SessionStore
  accessPolicy: AccessPolicy
  userRegistry: UserRegistryFile
  /**
   * The one way in this deployment offers, or none.
   *
   * Exactly one, because two would mean two identities for one person and no
   * rule for which wins. An empty list mounts no start route at all,
   * so a misconfigured server says so at the door rather than mid-flow.
   */
  loginProviders: readonly LoginProvider[]
  /**
   * Where the Studio bundle is served from.
   * Login redirects land here, with `#token=...` in the fragment.
   * Studio reads, stores, navigates.
   * Defaults to the Vite dev server origin when unset.
   */
  studioUrl: string
  /**
   * Whether a caller must authenticate.
   * Mirrored into `/auth/config.requiresAuth`,
   * telling the Studio whether to gate behind the Login page.
   * When false, anonymous sessions fall through, fine for a sidecar or dev.
   * When true, the Login page is mandatory.
   */
  requiresAuth: boolean
}

const LogoutBody = z.object({
  returnTo: z.string().url().optional(),
})

const StartQuery = z.object({
  returnTo: z.string().url().optional(),
})

const CallbackQuery = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
})

export function createAuthRouter(deps: AuthRouterDeps): Hono {
  const router = new Hono()
  // In-memory pending flows.
  // A single-process server is the only supported topology in v0.2.
  // HA or multi-process would need a shared store,
  // but that's well past current scope.
  const pending = new Map<string, PendingFlow>()

  function reapExpired(): void {
    const cutoff = Date.now() - PENDING_TTL_MS
    for (const [state, flow] of pending) {
      if (flow.createdAt < cutoff)
        pending.delete(state)
    }
  }

  for (const provider of deps.loginProviders) {
    router.get(`/${provider.id}/start`, async (context) => {
      reapExpired()
      const parsed = StartQuery.safeParse({ returnTo: context.req.query('returnTo') })
      if (!parsed.success)
        throw new ValidationError('Invalid returnTo query parameter.')
      const state = createOAuthState()
      const codeVerifier = createPkceVerifier()
      pending.set(state, {
        codeVerifier,
        returnTo: parsed.data.returnTo ?? deps.studioUrl,
        createdAt: Date.now(),
      })
      return context.json({ authorizationUrl: await provider.buildLoginUrl({ state, codeVerifier }) })
    })

    router.get(`/${provider.id}/callback`, async (context) => {
      const parsed = CallbackQuery.safeParse({
        code: context.req.query('code'),
        state: context.req.query('state'),
        error: context.req.query('error'),
        error_description: context.req.query('error_description'),
      })
      if (!parsed.success)
        throw new ValidationError('Invalid callback parameters.')
      const { code, state, error, error_description: errorDescription } = parsed.data
      if (error || !code || !state)
        return redirectWithError(context, deps.studioUrl, error_description_or_default(error, errorDescription))

      const flow = pending.get(state)
      if (!flow)
        return redirectWithError(context, deps.studioUrl, 'Session expired before sign-in completed. Try again.')
      pending.delete(state)

      let profile
      try {
        profile = await provider.loginWithCode({ code, codeVerifier: flow.codeVerifier })
      }
      catch (err) {
        return redirectWithError(context, flow.returnTo, err instanceof Error ? err.message : String(err))
      }

      const decision = await deps.accessPolicy.decide(profile.email)
      if (!decision.allow)
        return redirectWithError(context, flow.returnTo, decision.reason ?? 'Not authorized.')

      const user = await upsertUser(deps, profile, decision)
      const session = await deps.sessionStore.issue(user.id)
      return context.redirect(`${flow.returnTo}#token=${encodeURIComponent(session.token)}`, 302)
    })
  }

  // Revoking Braid's session is only half of it. The provider keeps its own,
  // so the answer carries where to end that one too, and the caller sends the
  // browser there. Null when the provider offers no such endpoint, which
  // leaves the old behaviour of a purely local sign-out.
  router.post('/logout', async (context) => {
    const header = context.req.header('Authorization')
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null
    if (token)
      await deps.sessionStore.revoke(token)
    const parsed = LogoutBody.safeParse(await context.req.json().catch(() => ({})))
    const returnTo = parsed.success && parsed.data.returnTo ? parsed.data.returnTo : deps.studioUrl
    const provider = deps.loginProviders[0]
    const endSessionUrl = await provider?.endSessionUrl?.({ returnTo })
    return context.json({ endSessionUrl: endSessionUrl ?? null })
  })

  router.get('/whoami', async (context) => {
    // `/auth/*` is in the auth middleware's PUBLIC_PATH_PREFIXES,
    // so the Bearer header isn't validated upstream.
    // Whoami exists precisely to identify the caller,
    // so resolve the Bearer token here directly,
    // rather than trusting the auth middleware's local-user fallback.
    // An absent or invalid token yields `{ user: null }`.
    const header = context.req.header('Authorization')
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null
    let userId: UserId | undefined
    if (token) {
      const session = await deps.sessionStore.resolve(token)
      userId = session?.userId
    }
    // A deployment without enforced auth doesn't issue tokens,
    // so fall back to the context userId, keeping /whoami working there.
    // authMiddleware wouldn't have rejected the request anyway.
    if (!userId && !deps.requiresAuth)
      userId = context.get('userId') as UserId | undefined
    if (!userId)
      return context.json({ user: null })
    try {
      const user = await deps.userRegistry.get(userId)
      return context.json({ user: user ?? null })
    }
    catch (err) {
      if (err instanceof NotFoundError)
        return context.json({ user: null })
      throw err
    }
  })

  // Hint at the configured studio URL and auth mode,
  // so the Login page can decide whether to gate at all,
  // single-tenant skips it, and whether Google is configured,
  // since otherwise the Sign-in button leads to a 503.
  router.get('/config', (context) => {
    return context.json({
      googleEnabled: deps.loginProviders.some(provider => provider.id === 'google'),
      // Which door to knock on. Studio sends the person to
      // `/auth/{loginProvider}/start` rather than guessing.
      loginProvider: deps.loginProviders[0]?.id ?? null,
      studioUrl: deps.studioUrl,
      requiresAuth: deps.requiresAuth,
    })
  })

  return router
}

/**
 * Resolve the person to a user record, creating one on first sign-in.
 *
 * Two join keys, in order. `sub` is tried first because it survives an email
 * change, but it only names the person inside one provider, so it stops
 * matching the moment a deployment puts an authorization server in front of
 * the login it used to run itself. Email is what carries across that move,
 * and adopting the record rather than creating a second one is what keeps a
 * person's workspaces, runs, and proposals attached to them.
 *
 * The record keeps the subject it was created with, since that field is
 * immutable by design, so an adopted record is found by email every time.
 * That is a lookup per sign-in against a small file, and the alternative is
 * making the join key rewritable, which is a worse trade.
 *
 * An admin list edited after the fact promotes on the next sign-in, so
 * redeploying with a new roster never needs manual surgery on the registry.
 */
async function upsertUser(
  deps: AuthRouterDeps,
  profile: LoginProfile,
  decision: { viaInvite?: { serverRole?: 'admin' | 'user' } },
): Promise<{ id: UserId, serverRole: string }> {
  const isAdmin = deps.accessPolicy.isAdmin(profile.email)
  let user = await deps.userRegistry.getByGoogleSub(profile.sub)
  if (!user) {
    user = await deps.userRegistry.getByEmail(profile.email)
  }
  if (!user) {
    user = await deps.userRegistry.create({
      id: newUserId(),
      googleSub: profile.sub,
      email: profile.email,
      displayName: profile.displayName,
      serverRole: isAdmin ? 'admin' : decision.viaInvite?.serverRole ?? 'user',
      createdAt: deps.clock.now() as Timestamp,
    })
    if (decision.viaInvite)
      await deps.accessPolicy.consumeInvite(profile.email)
  }
  else if (isAdmin && user.serverRole !== 'admin') {
    user = await deps.userRegistry.update(user.id, { serverRole: 'admin' })
  }
  return user
}

function redirectWithError(context: Context, target: string, reason: string): Response {
  // Use a clearly named hash key.
  // The Studio side pulls the error out and shows it on the Login page.
  const url = `${target}#auth-error=${encodeURIComponent(reason)}`
  return context.redirect(url, 302)
}

function error_description_or_default(error: string | undefined, description: string | undefined): string {
  if (description && description.length > 0)
    return description
  if (error && error.length > 0)
    return error
  return 'Google sign-in failed.'
}
