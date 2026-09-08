import type { CoverageProjection, WorkspaceRepository } from '@braidhq/core'
import { CoverageBoard } from '@braidhq/schema'
import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import { getWorkspaceId } from '../middleware/workspaceId.js'
import { WorkspaceIdParam } from './_shared.js'
import { loadWorkspaceById } from './helpers.js'

export interface CoverageRouterDeps {
  readonly coverageProjection: CoverageProjection
  readonly workspaceRepository: WorkspaceRepository
}

const boardRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'getCoverageBoard',
  summary: 'Every source document, and what the model has made of it.',
  description: 'One card per source unit, carrying the state it is in, the run that last touched it, and what it left waiting. The stages are read off the workspace ontology own build skills, so a different ontology yields a different pipeline without this endpoint knowing either one.',
  tags: ['coverage'],
  request: { params: WorkspaceIdParam },
  responses: {
    200: {
      description: 'The coverage board for this workspace.',
      content: { 'application/json': { schema: CoverageBoard } },
    },
  },
})

export function createCoverageRouter(deps: CoverageRouterDeps): OpenAPIHono {
  const router = new OpenAPIHono()

  router.openapi(boardRoute, async (context) => {
    const workspace = await loadWorkspaceById(getWorkspaceId(context), deps.workspaceRepository)
    return context.json(await deps.coverageProjection.board(workspace), 200)
  })

  return router
}
