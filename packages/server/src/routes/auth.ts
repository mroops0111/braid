import type { Clock } from '@braidhq/core'
import type { Timestamp, UserId } from '@braidhq/schema'
import type { Context } from 'hono'
import type { AccessPolicy } from '../infrastructure/auth/AccessPolicy.js'
import type { SessionStore } from '../infrastructure/auth/SessionStore.js'
import type { GoogleOAuth } from '../infrastructure/oauth/GoogleOAuth.js'
import type { UserRegistryFile } from '../infrastructure/users/UserRegistryFile.js'
import { newUserId, NotFoundError } from '@braidhq/core'
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
   * When undefined, `/auth/google/*` respond with 503,
   * so the operator knows the server is missing OAuth env config,
   * rather than failing silently mid-flow.
   */
  googleOAuth?: GoogleOAuth
  /**
   * Where the Studio bundle is served from.
   * Login redirects land here, with `#token=...` in the fragment.
   * Studio reads, stores, navigates.
   * Defaults to the Vite dev server origin when unset.
   */
  studioUrl: string
  /**
   * The single-tenant default principal, or null for multi-tenant.
   * Mirrored into `/auth/config.requiresAuth`,
   * telling the Studio whether to gate behind the Login page.
   * When set, anonymous sessions fall through to it, fine for a sidecar or dev.
   * When null, the Login page is mandatory.
   */
  defaultPrincipal: UserId | null
}

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

  router.get('/google/start', async (context) => {
    if (!deps.googleOAuth) {
      return context.json(
        {
          title: 'Google sign-in unavailable',
          detail: 'Server is missing BRAID_GOOGLE_CLIENT_ID / BRAID_GOOGLE_CLIENT_SECRET; ask the admin to configure them.',
        },
        503,
      )
    }
    reapExpired()
    const parsed = StartQuery.safeParse({
      returnTo: context.req.query('returnTo'),
    })
    if (!parsed.success)
      return context.json({ title: 'Invalid returnTo' }, 400)
    const state = createOAuthState()
    const codeVerifier = createPkceVerifier()
    pending.set(state, {
      codeVerifier,
      returnTo: parsed.data.returnTo ?? deps.studioUrl,
      createdAt: Date.now(),
    })
    const url = deps.googleOAuth.buildLoginUrl({ state, codeVerifier })
    return context.json({ authorizationUrl: url })
  })

  router.get('/google/callback', async (context) => {
    if (!deps.googleOAuth)
      return context.text('Google sign-in is not configured on this server.', 503)
    const parsed = CallbackQuery.safeParse({
      code: context.req.query('code'),
      state: context.req.query('state'),
      error: context.req.query('error'),
      error_description: context.req.query('error_description'),
    })
    if (!parsed.success)
      return context.text('Invalid callback parameters.', 400)
    const { code, state, error, error_description: errorDescription } = parsed.data
    if (error || !code || !state)
      return redirectWithError(context, deps.studioUrl, error_description_or_default(error, errorDescription))

    const flow = pending.get(state)
    if (!flow)
      return redirectWithError(context, deps.studioUrl, 'Session expired before sign-in completed. Try again.')
    pending.delete(state)

    let profile
    try {
      profile = await deps.googleOAuth.loginWithCode({ code, codeVerifier: flow.codeVerifier })
    }
    catch (err) {
      return redirectWithError(context, flow.returnTo, err instanceof Error ? err.message : String(err))
    }

    const decision = await deps.accessPolicy.decide(profile.email)
    if (!decision.allow)
      return redirectWithError(context, flow.returnTo, decision.reason ?? 'Not authorized.')

    // Resolve or create the user record. Google `sub` survives an email change,
    // so prefer it as the join key,
    // falling back to email for invited users new to login.
    const isAdmin = deps.accessPolicy.isAdmin(profile.email)
    let user = await deps.userRegistry.getByGoogleSub(profile.sub)
    if (!user) {
      const inviteRole = decision.viaInvite?.serverRole
      user = await deps.userRegistry.create({
        id: newUserId(),
        googleSub: profile.sub,
        email: profile.email,
        displayName: profile.displayName,
        serverRole: isAdmin ? 'admin' : inviteRole ?? 'user',
        createdAt: deps.clock.now() as Timestamp,
      })
      if (decision.viaInvite)
        await deps.accessPolicy.consumeInvite(profile.email)
    }
    else if (isAdmin && user.serverRole !== 'admin') {
      // BRAID_ADMIN_EMAILS was edited after this user was created.
      // Promote on next login, so re-deploying with a new admin list,
      // never needs manual user-table surgery.
      user = await deps.userRegistry.update(user.id, { serverRole: 'admin' })
    }

    const session = await deps.sessionStore.issue(user.id)
    const target = `${flow.returnTo}#token=${encodeURIComponent(session.token)}`
    return context.redirect(target, 302)
  })

  router.post('/logout', async (context) => {
    const header = context.req.header('Authorization')
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null
    if (token)
      await deps.sessionStore.revoke(token)
    return context.body(null, 204)
  })

  router.get('/whoami', async (context) => {
    // `/auth/*` is in the auth middleware's PUBLIC_PREFIXES,
    // so the Bearer header isn't validated upstream.
    // Whoami exists precisely to identify the caller,
    // so resolve the Bearer token here directly,
    // rather than trusting `userIdMiddleware`'s local-user fallback.
    // An absent or invalid token yields `{ user: null }`.
    const header = context.req.header('Authorization')
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null
    let userId: UserId | undefined
    if (token) {
      const session = await deps.sessionStore.resolve(token)
      userId = session?.userId
    }
    // Single-tenant deployments don't issue tokens,
    // so fall back to the context userId, keeping /whoami working there.
    // authMiddleware wouldn't have rejected the request anyway.
    if (!userId && deps.defaultPrincipal !== null)
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
      googleEnabled: deps.googleOAuth !== undefined,
      studioUrl: deps.studioUrl,
      requiresAuth: deps.defaultPrincipal === null,
    })
  })

  return router
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
