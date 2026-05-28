import type { AppDependencies } from './composition.js'
import { OpenAPIHono } from '@hono/zod-openapi'
import { corsMiddleware } from './middleware/cors.js'
import { errorHandler } from './middleware/error.js'
import { workspaceIdMiddleware } from './middleware/workspaceId.js'
import { createClarifyRouter } from './routes/clarify.js'
import { createDecisionsRouter } from './routes/decisions.js'
import { createEdgesRouter } from './routes/edges.js'
import { healthRouter } from './routes/health.js'
import { createModelRouter } from './routes/model.js'
import { createNodesRouter } from './routes/nodes.js'
import { createOAuthRouter } from './routes/oauth.js'
import { createOntologyRouter } from './routes/ontology.js'
import { createProposalsRouter } from './routes/proposals.js'
import { createRunsRouter } from './routes/runs.js'
import { createSkillInputOptionsRouter } from './routes/skillInputOptions.js'
import { createSkillsRouter } from './routes/skills.js'
import { createWorkspaceEventsRouter } from './routes/workspaceEvents.js'
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
}

export function createApp(deps: AppDependencies, options: AppOptions = {}): OpenAPIHono {
  const app = new OpenAPIHono()
  app.use(
    '*',
    options.corsOrigins
      ? corsMiddleware({ allowedOrigins: options.corsOrigins })
      : corsMiddleware(),
  )
  app.onError(errorHandler)

  app.route('/health', healthRouter)
  app.route('/workspaces', createWorkspacesRouter({
    workspaceService: deps.workspaceService,
    sourceLoaderRunner: deps.sourceLoaderRunner,
    workspacesRoot: deps.workspacesRoot,
  }))
  app.route('/workspaces', createWorkspaceEventsRouter({ eventBus: deps.eventBus }))

  const workspaceScoped = new OpenAPIHono()
  workspaceScoped.use('*', workspaceIdMiddleware)
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
  workspaceScoped.route('/skill-input-options', createSkillInputOptionsRouter({
    modelRepository: deps.modelRepository,
    clarifyRepository: deps.clarifyRepository,
    workspaceRepository: deps.workspaceRepository,
    pluginRegistry: deps.pluginRegistry,
  }))

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
