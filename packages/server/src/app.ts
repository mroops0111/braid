import type { AppDependencies } from './composeApp.js'
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
import { createEdgesRouter } from './routes/edges.js'
import { healthRouter } from './routes/health.js'
import { createHistoryRouter } from './routes/history.js'
import { createModelRouter } from './routes/model.js'
import { createNodesRouter } from './routes/nodes.js'
import { createOAuthRouter } from './routes/oauth.js'
import { createOntologyRouter } from './routes/ontology.js'
import { createProposalsRouter } from './routes/proposals.js'
import { createReactorCyclesRouter } from './routes/reactorCycles.js'
import { createRunsRouter } from './routes/runs.js'
import { createSkillInputOptionsRouter } from './routes/skillInputOptions.js'
import { createSkillsRouter } from './routes/skills.js'
import { createSourceLoadersRouter } from './routes/sourceLoaders.js'
import { createSourceUnitObservationsRouter } from './routes/sourceUnitObservations.js'
import { createGithubWebhookReceiver, createSourceWebhooksAdminRouter } from './routes/sourceWebhooks.js'
import { createUsersRouter } from './routes/users.js'
import { createWorkspaceEventsRouter } from './routes/workspaceEvents.js'
import { createTransferOwnershipRouter, createWorkspaceMembersRouter } from './routes/workspaceMembers.js'
import { createWorkspacesRouter } from './routes/workspaces.js'

export interface AppOptions {
  readonly corsOrigins?: readonly string[]
  /**
   * Base URL the OpenAPI spec advertises in its `servers[]` block.
   * Downstream consumers use it to dispatch REST calls,
   * openapi-mcp-gateway, Swagger UI, and code generators among them.
   * When unset, the spec omits `servers[]` and leaves the consumer to guess.
   * `composeFsApp` threads its `apiUrl` here,
   * so the gateway routes calls back without an explicit base-url flag.
   */
  readonly apiUrl?: string
}

export function createApp(deps: AppDependencies, options: AppOptions = {}): OpenAPIHono {
  const app = new OpenAPIHono()
  app.use(
    '*',
    options.corsOrigins
      ? corsMiddleware({ allowedOrigins: options.corsOrigins })
      : corsMiddleware(),
  )
  // Auth gate. Single-tenant short-circuits, letting the request through.
  // Otherwise a Bearer token from a Google OAuth session is required.
  // Public routes, `/auth/*` and `/health`, are excluded,
  // so the login flow itself is not gated.
  if (deps.sessionStore) {
    app.use('*', authMiddleware({
      sessionStore: deps.sessionStore,
      defaultPrincipal: deps.tenancy.defaultPrincipal,
    }))
  }
  // Identity. Stamps `userId` on the context from `X-Braid-User`,
  // when the auth layer left it empty, i.e. single-tenant or a public route.
  // Bearer requests already carry a userId here, and pass untouched.
  app.use('*', userIdMiddleware(deps.tenancy.defaultPrincipal))
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
      defaultPrincipal: deps.tenancy.defaultPrincipal,
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
    pluginRegistry: deps.pluginRegistry,
    ...(deps.bootstrap ? { bootstrap: deps.bootstrap } : {}),
    ...(deps.workspaceRegistry ? { workspaceRegistry: deps.workspaceRegistry } : {}),
    ...(deps.userRegistry ? { userRegistry: deps.userRegistry } : {}),
    ...(deps.historyService ? { historyService: deps.historyService } : {}),
  }))
  app.route('/workspaces', createWorkspaceEventsRouter({ eventBus: deps.eventBus }))
  // Server-level plugin discovery for Studio's loader dropdown,
  // sourced from the active PluginRegistry, not hardcoded strings.
  // Installed loaders are identical across workspaces, not scoped to one.
  app.route('/source-loaders', createSourceLoadersRouter({ pluginRegistry: deps.pluginRegistry }))

  // Public webhook receivers, authenticated by per-source HMAC secrets,
  // inside the handler, not by a Bearer token.
  // The auth middleware exempts the `/webhooks/` prefix.
  // Mounted only when a SecretStore is wired,
  // without one there is nowhere to read the secrets.
  if (deps.secretStore) {
    app.route('/webhooks', createGithubWebhookReceiver({
      workspaceService: deps.workspaceService,
      sourceLoaderRunner: deps.sourceLoaderRunner,
      secretStore: deps.secretStore,
      pluginRegistry: deps.pluginRegistry,
    }))
  }

  const workspaceScoped = new OpenAPIHono()
  workspaceScoped.use('*', workspaceIdMiddleware)
  // Workspace membership gate, present only in composeFsApp,
  // which wires both the workspace registry and the user registry.
  // In-memory tests compose without these and stay open,
  // so existing routes keep behaving.
  if (deps.workspaceRegistry && deps.userRegistry) {
    workspaceScoped.use('*', workspaceAccessMiddleware({
      registry: deps.workspaceRegistry,
      workspaceService: deps.workspaceService,
      userRegistry: deps.userRegistry,
    }))
  }
  workspaceScoped.route('/model', createModelRouter({ modelService: deps.modelService }))
  workspaceScoped.route('/nodes', createNodesRouter({ modelService: deps.modelService }))
  workspaceScoped.route('/edges', createEdgesRouter({ modelService: deps.modelService }))
  workspaceScoped.route('/proposals', createProposalsRouter({
    hitlService: deps.hitlService,
    proposalRepository: deps.proposalRepository,
    modelRepository: deps.modelRepository,
    modelValidationService: deps.modelValidationService,
    workspaceService: deps.workspaceService,
  }))
  workspaceScoped.route('/clarify', createClarifyRouter({
    hitlService: deps.hitlService,
    clarifyRepository: deps.clarifyRepository,
  }))
  workspaceScoped.route('/source-unit-states', createSourceUnitObservationsRouter({
    sourceUnitObservationService: deps.sourceUnitObservationService,
    ...(deps.intentLister && deps.sourceUnitDigest
      ? {
          diffSupport: {
            workspaceService: deps.workspaceService,
            intentLister: deps.intentLister,
            digest: deps.sourceUnitDigest,
          },
        }
      : {}),
  }))
  workspaceScoped.route('/ontology', createOntologyRouter({
    workspaceRepository: deps.workspaceRepository,
    pluginRegistry: deps.pluginRegistry,
  }))

  if (deps.skillRegistry && deps.skillRunner) {
    workspaceScoped.route('/skills', createSkillsRouter({
      skillRegistry: deps.skillRegistry,
      skillRunner: deps.skillRunner,
      workspaceRepository: deps.workspaceRepository,
      sourceUnitObservationService: deps.sourceUnitObservationService,
      runRepository: deps.runRepository,
      pluginRegistry: deps.pluginRegistry,
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
  workspaceScoped.route('/reactor-cycles', createReactorCyclesRouter({
    reactorCycleRepository: deps.reactorCycleRepository,
  }))
  if (deps.secretStore) {
    workspaceScoped.route('/source-webhooks', createSourceWebhooksAdminRouter({
      workspaceService: deps.workspaceService,
      secretStore: deps.secretStore,
      pluginRegistry: deps.pluginRegistry,
      ...(options.apiUrl ? { apiUrl: options.apiUrl } : {}),
    }))
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

  // OpenAPI 3 spec, consumed by openapi-mcp-gateway, to surface REST operations as MCP tools.
  // SSE routes and the OAuth HTML callback are intentionally absent,
  // they mount via app.route() with plain Hono sub-routers, so they don't register with the OpenAPI registry.
  // The `servers[]` block lets the gateway resolve the upstream API base URL, without an explicit --base-url flag.
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
