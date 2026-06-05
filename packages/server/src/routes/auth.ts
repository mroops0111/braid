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
   * When undefined, `/auth/google/*` respond with 503 so the operator
   * knows the server is missing OAuth env config rather than failing
   * silently mid-flow.
   */
  googleOAuth?: GoogleOAuth
  /**
   * Where the Studio bundle is served from. Login redirects land here
   * with `#token=...` in the fragment; Studio reads, stores, navigates.
   * Defaults to the Vite dev server origin when unset.
   */
  studioUrl: string
  /**
   * Mirrored into `/auth/config.requiresAuth` so the Studio knows
   * whether to gate behind the Login page. `true` means anonymous
   * sessions fall through to `local-user` — fine for embedded
   * sidecar / dev; `false` means the Login page is mandatory.
   */
  localTrust: boolean
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
  // In-memory pending flows. A single-process server is the only
  // supported topology in v0.2; HA / multi-process would need this in
  // a shared store, but that's well past current scope.
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

    // Resolve / create the user record. Google `sub` is stable across
    // email changes; prefer it as the join key, fall back to email
    // for invited users who haven't logged in before.
    let user = await deps.userRegistry.getByGoogleSub(profile.sub)
    if (!user) {
      const inviteRole = decision.viaInvite?.serverRole
      const inviteCanCreate = decision.viaInvite?.canCreateWorkspace
      const isAdmin = deps.accessPolicy.isAdmin(profile.email)
      user = await deps.userRegistry.create({
        id: newUserId(),
        googleSub: profile.sub,
        email: profile.email,
        displayName: profile.displayName,
        serverRole: isAdmin ? 'admin' : inviteRole ?? 'user',
        canCreateWorkspace: inviteCanCreate ?? false,
        createdAt: deps.clock.now() as Timestamp,
      })
      if (decision.viaInvite)
        await deps.accessPolicy.consumeInvite(profile.email)
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
    const userId = context.get('userId') as UserId | undefined
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

  // Hint at the configured studio URL + auth mode so the Login page
  // can decide whether to gate at all (local trust skips), and
  // whether Google is actually configured (otherwise the Sign-in
  // button leads to a 503).
  router.get('/config', (context) => {
    return context.json({
      googleEnabled: deps.googleOAuth !== undefined,
      studioUrl: deps.studioUrl,
      requiresAuth: !deps.localTrust,
    })
  })

  return router
}

function redirectWithError(context: Context, target: string, reason: string): Response {
  // Use a clearly named hash key so the Studio side knows to pull the
  // error out and surface it on the Login page.
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
