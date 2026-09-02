import type { AppDependencies } from './composeApp.js'
import { serveStatic } from '@hono/node-server/serve-static'
import { OpenAPIHono } from '@hono/zod-openapi'
import { SessionTokenVerifier } from './infrastructure/auth/SessionTokenVerifier.js'
import { authMiddleware } from './middleware/auth.js'
import { corsMiddleware } from './middleware/cors.js'
import { errorHandler } from './middleware/error.js'
import { workspaceAccessMiddleware } from './middleware/workspaceAccess.js'
import { workspaceIdMiddleware } from './middleware/workspaceId.js'
import { createAdminRouter } from './routes/admin.js'
import { createAuthRouter } from './routes/auth.js'
import { createBatchRouter } from './routes/batch.js'
import { createClarificationRouter } from './routes/clarifications.js'
import { createEdgesRouter } from './routes/edges.js'
import { createEmbeddingsRouter } from './routes/embeddings.js'
import { healthRouter } from './routes/health.js'
import { createHistoryRouter } from './routes/history.js'
import { createModelRouter } from './routes/model.js'
import { createNodesRouter } from './routes/nodes.js'
import { createOAuthCallbackRouter, createOAuthStartRouter, OAuthFlowStore } from './routes/oauth.js'
import { createOntologiesRouter } from './routes/ontologies.js'
import { createOntologyRouter } from './routes/ontology.js'
import { createProposalsRouter } from './routes/proposals.js'
import { createProtectedResourceRouter } from './routes/protectedResource.js'
import { createReactorCyclesRouter } from './routes/reactorCycles.js'
import { createRunsRouter } from './routes/runs.js'
import { createSkillInputOptionsRouter } from './routes/skillInputOptions.js'
import { createSkillsRouter } from './routes/skills.js'
import { createSourceConnectionRouter } from './routes/sourceConnection.js'
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

  // Global middleware, every request passes these in order.
  const corsOrigins = deps.corsOrigins ?? options.corsOrigins
  app.use('*', corsOrigins ? corsMiddleware({ allowedOrigins: corsOrigins }) : corsMiddleware())
  // The app shell is what a signed-out visitor loads in order to sign in,
  // so it mounts before the auth gate.
  // Gating it would leave nobody able to reach the login screen,
  // while the API behind it stays gated. Vite emits `index.html` and `assets/`,
  // neither of which can collide with an API prefix,
  // and a miss falls through to the routes below.
  if (deps.studioRoot) {
    const root = deps.studioRoot
    app.use('/*', serveStatic({ root, index: 'index.html' }))
  }

  // Identity and auth gate. Resolves the caller's `userId` from a Bearer session
  // when auth is enforced, else the `X-Braid-User` header or the default principal.
  // Non-public routes that lack a required Bearer token are rejected.
  // Sessions first, since the browser is the common case,
  // and every other verifier would repeat that lookup before declining.
  // Anything a deployment configured follows.
  const accessTokenVerifiers = [
    ...(deps.sessionStore ? [new SessionTokenVerifier(deps.sessionStore)] : []),
    ...(deps.accessTokenVerifiers ?? []),
  ]
  app.use('*', authMiddleware({
    ...(deps.sessionStore ? { sessionStore: deps.sessionStore } : {}),
    requireAuth: deps.authMode.requiresAuth,
    defaultPrincipal: deps.authMode.defaultPrincipal,
    accessTokenVerifiers,
  }))
  app.onError(errorHandler)

  // Only when an issuer is trusted.
  // Advertising an empty list would point a client at a way in that does not exist.
  if (deps.oidcIssuer && deps.apiUrl) {
    app.route('/.well-known/oauth-protected-resource', createProtectedResourceRouter({
      resource: deps.apiUrl,
      authorizationServers: [deps.oidcIssuer],
    }))
  }

  // Host-level routes, not scoped to a single workspace.
  app.route('/health', healthRouter)
  if (deps.sessionStore && deps.accessPolicy && deps.userRegistry) {
    app.route('/auth', createAuthRouter({
      clock: deps.clock,
      sessionStore: deps.sessionStore,
      accessPolicy: deps.accessPolicy,
      userRegistry: deps.userRegistry,
      ...(deps.googleOAuth ? { googleOAuth: deps.googleOAuth } : {}),
      studioUrl: deps.studioUrl ?? 'http://localhost:5173',
      requiresAuth: deps.authMode.requiresAuth,
    }))
  }
  if (deps.userRegistry) {
    app.route('/users', createUsersRouter({
      userRegistry: deps.userRegistry,
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
    sourceSyncService: deps.sourceSyncService,
    sourcePollingService: deps.sourcePollingService,
    syncStateRepository: deps.syncStateRepository,
    workspacesRoot: deps.workspacesRoot,
    pluginRegistry: deps.pluginRegistry,
    ...(deps.defaultOntologyId ? { defaultOntologyId: deps.defaultOntologyId } : {}),
    ...(deps.bootstrap ? { bootstrap: deps.bootstrap } : {}),
    ...(deps.workspaceRegistry ? { workspaceRegistry: deps.workspaceRegistry } : {}),
    ...(deps.userRegistry ? { userRegistry: deps.userRegistry } : {}),
    ...(deps.historyService ? { historyService: deps.historyService } : {}),
  }))
  // Server-level plugin discovery for Studio's loader dropdown,
  // sourced from the active PluginRegistry, not hardcoded strings.
  // Installed loaders are identical across workspaces, not scoped to one.
  app.route('/source-loaders', createSourceLoadersRouter({ pluginRegistry: deps.pluginRegistry }))
  app.route('/ontologies', createOntologiesRouter({ pluginRegistry: deps.pluginRegistry }))

  // Public webhook receivers, authenticated by per-source HMAC secrets,
  // inside the handler, not by a Bearer token.
  // The auth middleware exempts the `/webhooks/` prefix.
  // Mounted only when a SecretStore is wired,
  // without one there is nowhere to read the secrets.
  if (deps.secretStore) {
    app.route('/webhooks', createGithubWebhookReceiver({
      workspaceService: deps.workspaceService,
      sourceSyncService: deps.sourceSyncService,
      ...(deps.isWorkspaceBusy ? { isWorkspaceBusy: deps.isWorkspaceBusy } : {}),
      secretStore: deps.secretStore,
      pluginRegistry: deps.pluginRegistry,
    }))
  }

  // Shared by the OAuth start and callback routers,
  // so a flow opened by start is resolved by callback.
  const oauthFlowStore = new OAuthFlowStore()

  // Workspace-scoped sub-app, mounted under `/workspaces/:workspaceId` below.
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
  // Mounted under the workspace-scoped app rather than on `/workspaces`,
  // so the membership gate above covers the event stream too.
  workspaceScoped.route('/events', createWorkspaceEventsRouter({ eventBus: deps.eventBus }))
  workspaceScoped.route('/model', createModelRouter({ modelService: deps.modelService }))
  workspaceScoped.route('/embeddings', createEmbeddingsRouter(
    deps.embeddingService ? { embeddingService: deps.embeddingService } : {},
  ))
  workspaceScoped.route('/nodes', createNodesRouter({
    modelService: deps.modelService,
    ...(deps.embeddingService ? { embeddingService: deps.embeddingService } : {}),
  }))
  workspaceScoped.route('/edges', createEdgesRouter({ modelService: deps.modelService }))
  workspaceScoped.route('/proposals', createProposalsRouter({
    hitlService: deps.hitlService,
    proposalRepository: deps.proposalRepository,
    modelRepository: deps.modelRepository,
    modelValidationService: deps.modelValidationService,
    workspaceService: deps.workspaceService,
  }))
  workspaceScoped.route('/clarifications', createClarificationRouter({
    hitlService: deps.hitlService,
    clarificationRepository: deps.clarificationRepository,
  }))
  workspaceScoped.route('/source-unit-states', createSourceUnitObservationsRouter({
    sourceUnitObservationService: deps.sourceUnitObservationService,
    ...(deps.unitLister && deps.sourceUnitDigest
      ? {
          diffSupport: {
            workspaceService: deps.workspaceService,
            unitLister: deps.unitLister,
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
      sourceSyncService: deps.sourceSyncService,
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
    workspaceScoped.route('/source-connections', createSourceConnectionRouter({ secretStore: deps.secretStore, workspaceService: deps.workspaceService }))
  }
  workspaceScoped.route('/skill-input-options', createSkillInputOptionsRouter({
    modelRepository: deps.modelRepository,
    clarificationRepository: deps.clarificationRepository,
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
    // Start is owner-gated in-handler,
    // so an existing workspace needs `workspace.write`,
    // while the Wizard can connect before scaffold.
    app.route('/oauth', createOAuthStartRouter({
      secretStore: deps.secretStore,
      flowStore: oauthFlowStore,
      ...(deps.googleOAuth ? { google: deps.googleOAuth } : {}),
      ...(deps.githubOAuth ? { github: deps.githubOAuth } : {}),
      ...(deps.userRegistry ? { userRegistry: deps.userRegistry } : {}),
      workspaceService: deps.workspaceService,
      ...(deps.workspaceRegistry ? { workspaceRegistry: deps.workspaceRegistry } : {}),
    }))
    app.route('/oauth', createOAuthCallbackRouter({
      secretStore: deps.secretStore,
      flowStore: oauthFlowStore,
      ...(deps.googleOAuth ? { google: deps.googleOAuth } : {}),
      ...(deps.githubOAuth ? { github: deps.githubOAuth } : {}),
    }))
  }

  // OpenAPI 3 spec, consumed by openapi-mcp-gateway, to surface REST operations as MCP tools.
  // SSE routes and the OAuth HTML callback are intentionally absent,
  // they mount plain Hono sub-routers, so they never register with the doc.
  // The `servers[]` block lets the gateway resolve the upstream base URL,
  // without an explicit --base-url flag.
  // 3.1 so schemas are JSON Schema 2020-12,
  // the dialect a tool `input_schema` is validated against.
  // A 3.0 doc emits `nullable` and boolean `exclusiveMinimum`,
  // which the model API rejects once the gateway forwards them as MCP tool schemas.
  app.doc31('/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'Braid REST API',
      version: '0.0.1',
      description: 'REST surface exposed by @braidhq/server. Each operation also becomes an MCP tool via openapi-mcp-gateway.',
    },
    ...(options.apiUrl ? { servers: [{ url: options.apiUrl }] } : {}),
  })

  return app
}
