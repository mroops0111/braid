import type { AppDependencies } from './composition.js'
import { OpenAPIHono } from '@hono/zod-openapi'
import { authMiddleware } from './middleware/auth.js'
import { corsMiddleware } from './middleware/cors.js'
import { errorHandler } from './middleware/error.js'
import { userIdMiddleware } from './middleware/userId.js'
import { workspaceAccessMiddleware } from './middleware/workspaceAccess.js'
import { workspaceIdMiddleware } from './middleware/workspaceId.js'
import { createAdminRouter } from './routes/admin.js'
import { createAuthRouter } from './routes/auth.js'
import { createBatchRouter } from './routes/batch.js'
import { createClarifyRouter } from './routes/clarify.js'
import { createDecisionsRouter } from './routes/decisions.js'
import { createEdgesRouter } from './routes/edges.js'
import { healthRouter } from './routes/health.js'
import { createHistoryRouter } from './routes/history.js'
import { createModelRouter } from './routes/model.js'
import { createNodesRouter } from './routes/nodes.js'
import { createOAuthRouter } from './routes/oauth.js'
import { createOntologyRouter } from './routes/ontology.js'
import { createProposalsRouter } from './routes/proposals.js'
import { createRunsRouter } from './routes/runs.js'
import { createSkillInputOptionsRouter } from './routes/skillInputOptions.js'
import { createSkillsRouter } from './routes/skills.js'
import { createUsersRouter } from './routes/users.js'
import { createWorkspaceEventsRouter } from './routes/workspaceEvents.js'
import { createTransferOwnershipRouter, createWorkspaceMembersRouter } from './routes/workspaceMembers.js'
import { createWorkspacesRouter } from './routes/workspaces.js'

export interface AppOptions {
  readonly corsOrigins?: readonly string[]
  /**
   * Base URL the OpenAPI spec advertises in its `servers[]` block. This
   * is what downstream consumers (openapi-mcp-gateway, Swagger UI, code
   * generators, …) use to dispatch REST calls. When unset, the spec is
   * emitted without `servers[]`, which leaves the consumer to guess.
   * composeFsApp threads its `apiUrl` through here so the gateway can
   * route REST calls back to this server without an explicit
   * `--base-url` flag.
   */
  readonly apiUrl?: string
  /**
   * When true (or `BRAID_LOCAL_TRUST=true`), the auth middleware lets
   * every request through and the embedded `userIdMiddleware` falls
   * back to `local-user`. Set by `composeFs` for the Tauri sidecar;
   * production remote servers leave it `false`.
   */
  readonly localTrust?: boolean
}

export function createApp(deps: AppDependencies, options: AppOptions = {}): OpenAPIHono {
  const app = new OpenAPIHono()
  app.use(
    '*',
    options.corsOrigins
      ? corsMiddleware({ allowedOrigins: options.corsOrigins })
      : corsMiddleware(),
  )
  // Phase B auth gate. In local-trust mode it short-circuits and lets
  // the unauthenticated request through; otherwise a Bearer token is
  // required (Google OAuth-issued session). Public routes — `/auth/*`,
  // `/health` — are excluded inside the middleware so the login flow
  // itself isn't gated.
  if (deps.sessionStore) {
    const localTrust = options.localTrust ?? deps.localTrust
    app.use('*', authMiddleware({
      sessionStore: deps.sessionStore,
      localTrust,
    }))
  }
  // Phase A identity. Stamps `c.set('userId', ...)` from `X-Braid-User`
  // when the auth layer left it empty — i.e. local-trust mode, or any
  // public route. Bearer-authenticated requests already have a userId
  // by the time this runs and pass through untouched.
  app.use('*', userIdMiddleware)
  app.onError(errorHandler)

  app.route('/health', healthRouter)
  if (deps.sessionStore && deps.accessPolicy && deps.userRegistry) {
    app.route('/auth', createAuthRouter({
      clock: deps.clock,
      sessionStore: deps.sessionStore,
      accessPolicy: deps.accessPolicy,
      userRegistry: deps.userRegistry,
      ...(deps.googleOAuth ? { googleOAuth: deps.googleOAuth } : {}),
      studioUrl: deps.studioUrl ?? 'http://localhost:5173',
      localTrust: options.localTrust ?? deps.localTrust,
    }))
  }
  if (deps.userRegistry) {
    app.route('/users', createUsersRouter({
      userRegistry: deps.userRegistry,
      clock: deps.clock,
    }))
  }
  if (deps.userRegistry && deps.accessPolicy && deps.workspaceRegistry) {
    app.route('/admin', createAdminRouter({
      userRegistry: deps.userRegistry,
      accessPolicy: deps.accessPolicy,
      workspaceRegistry: deps.workspaceRegistry,
      workspaceService: deps.workspaceService,
    }))
  }
  app.route('/workspaces', createWorkspacesRouter({
    workspaceService: deps.workspaceService,
    sourceLoaderRunner: deps.sourceLoaderRunner,
    workspacesRoot: deps.workspacesRoot,
    ...(deps.bootstrap ? { bootstrap: deps.bootstrap } : {}),
    ...(deps.workspaceRegistry ? { workspaceRegistry: deps.workspaceRegistry } : {}),
    ...(deps.userRegistry ? { userRegistry: deps.userRegistry } : {}),
  }))
  app.route('/workspaces', createWorkspaceEventsRouter({ eventBus: deps.eventBus }))

  const workspaceScoped = new OpenAPIHono()
  workspaceScoped.use('*', workspaceIdMiddleware)
  // Phase C membership gate. Mounted only when the workspaceRegistry is
  // present (i.e. composeFsApp); in-memory tests that compose without
  // a registry stay open so existing routes keep behaving.
  if (deps.workspaceRegistry) {
    workspaceScoped.use('*', workspaceAccessMiddleware({
      registry: deps.workspaceRegistry,
      workspaceService: deps.workspaceService,
      ...(deps.userRegistry ? { userRegistry: deps.userRegistry } : {}),
    }))
  }
  workspaceScoped.route('/model', createModelRouter({ modelService: deps.modelService }))
  workspaceScoped.route('/nodes', createNodesRouter({ modelService: deps.modelService }))
  workspaceScoped.route('/edges', createEdgesRouter({ modelService: deps.modelService }))
  workspaceScoped.route('/proposals', createProposalsRouter({
    hitlService: deps.hitlService,
    proposalRepository: deps.proposalRepository,
    modelRepository: deps.modelRepository,
    validationService: deps.validationService,
    workspaceService: deps.workspaceService,
  }))
  workspaceScoped.route('/clarify', createClarifyRouter({
    hitlService: deps.hitlService,
    clarifyRepository: deps.clarifyRepository,
    decisionRepository: deps.decisionRepository,
  }))
  workspaceScoped.route('/decisions', createDecisionsRouter({ decisionRepository: deps.decisionRepository }))
  workspaceScoped.route('/ontology', createOntologyRouter({
    workspaceRepository: deps.workspaceRepository,
    pluginRegistry: deps.pluginRegistry,
  }))

  if (deps.skillRegistry && deps.skillRunner) {
    workspaceScoped.route('/skills', createSkillsRouter({
      skillRegistry: deps.skillRegistry,
      skillRunner: deps.skillRunner,
      workspaceRepository: deps.workspaceRepository,
    }))
    workspaceScoped.route('/runs', createRunsRouter({
      runRepository: deps.runRepository,
      skillRunner: deps.skillRunner,
      workspaceRepository: deps.workspaceRepository,
    }))
  }
  if (deps.historyService) {
    workspaceScoped.route('/history', createHistoryRouter({ historyService: deps.historyService }))
  }
  if (deps.batchService) {
    workspaceScoped.route('/batch', createBatchRouter({ batchService: deps.batchService }))
  }
  workspaceScoped.route('/skill-input-options', createSkillInputOptionsRouter({
    modelRepository: deps.modelRepository,
    clarifyRepository: deps.clarifyRepository,
    workspaceRepository: deps.workspaceRepository,
    pluginRegistry: deps.pluginRegistry,
  }))
  if (deps.workspaceRegistry) {
    workspaceScoped.route('/members', createWorkspaceMembersRouter({
      workspaceService: deps.workspaceService,
      registry: deps.workspaceRegistry,
      clock: deps.clock,
    }))
    workspaceScoped.route('/transfer-ownership', createTransferOwnershipRouter({
      workspaceService: deps.workspaceService,
      registry: deps.workspaceRegistry,
      clock: deps.clock,
    }))
  }

  app.route('/workspaces/:workspaceId', workspaceScoped)

  if (deps.secretStore) {
    app.route('/oauth', createOAuthRouter({
      secretStore: deps.secretStore,
      ...(deps.googleOAuth ? { google: deps.googleOAuth } : {}),
    }))
  }

  // OpenAPI 3 spec; consumed by openapi-mcp-gateway to surface REST
  // operations as MCP tools. SSE routes and the OAuth HTML callback
  // are intentionally absent — they're mounted via app.route() with
  // plain Hono sub-routers so they don't register with the OpenAPI
  // registry. The `servers[]` block lets the gateway resolve the
  // upstream API base URL without an explicit --base-url flag.
  app.doc('/openapi.json', {
    openapi: '3.0.0',
    info: {
      title: 'Braid REST API',
      version: '0.0.1',
      description: 'REST surface exposed by @braidhq/server. Each operation also becomes an MCP tool via openapi-mcp-gateway.',
    },
    ...(options.apiUrl ? { servers: [{ url: options.apiUrl }] } : {}),
  })

  return app
}
