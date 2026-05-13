import type { AppDependencies } from './composition.js'
import { Hono } from 'hono'
import { corsMiddleware } from './middleware/cors.js'
import { errorHandler } from './middleware/error.js'
import { createClarifyRouter } from './routes/clarify.js'
import { createDecisionsRouter } from './routes/decisions.js'
import { createEdgesRouter } from './routes/edges.js'
import { healthRouter } from './routes/health.js'
import { createModelRouter } from './routes/model.js'
import { createNodesRouter } from './routes/nodes.js'
import { createProposalsRouter } from './routes/proposals.js'
import { createRunsRouter } from './routes/runs.js'
import { createSkillsRouter } from './routes/skills.js'
import { createWorkspacesRouter } from './routes/workspaces.js'

export interface AppOptions {
  readonly corsOrigins?: readonly string[]
}

export function createApp(deps: AppDependencies, options: AppOptions = {}): Hono {
  const app = new Hono()
  app.use(
    '*',
    options.corsOrigins
      ? corsMiddleware({ allowedOrigins: options.corsOrigins })
      : corsMiddleware(),
  )
  app.onError(errorHandler)

  app.route('/health', healthRouter)
  app.route('/workspaces', createWorkspacesRouter({ workspaceService: deps.workspaceService }))

  const workspaceScoped = new Hono()
  workspaceScoped.route('/model', createModelRouter({ modelService: deps.modelService }))
  workspaceScoped.route('/nodes', createNodesRouter({ modelService: deps.modelService }))
  workspaceScoped.route('/edges', createEdgesRouter({ modelService: deps.modelService }))
  workspaceScoped.route('/proposals', createProposalsRouter({
    hitlService: deps.hitlService,
    proposalRepository: deps.proposalRepository,
  }))
  workspaceScoped.route('/clarify', createClarifyRouter({
    hitlService: deps.hitlService,
    clarifyRepository: deps.clarifyRepository,
  }))
  workspaceScoped.route('/decisions', createDecisionsRouter({ decisionRepository: deps.decisionRepository }))

  if (deps.skillRegistry && deps.skillRunner) {
    workspaceScoped.route('/skills', createSkillsRouter({
      skillRegistry: deps.skillRegistry,
      skillRunner: deps.skillRunner,
      workspaceRepository: deps.workspaceRepository,
      runRepository: deps.runRepository,
    }))
    workspaceScoped.route('/runs', createRunsRouter({
      runRepository: deps.runRepository,
      skillRunner: deps.skillRunner,
      workspaceRepository: deps.workspaceRepository,
    }))
  }

  app.route('/workspaces/:workspaceId', workspaceScoped)

  return app
}
