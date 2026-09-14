import type { CoverageProjection, WorkspaceRepository } from '@braidhq/core'
import type { CoverageBoard as CoverageBoardType } from '@braidhq/schema'
import { CoverageBoard } from '@braidhq/schema'
import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import { getViewerContext } from '../middleware/workspaceAccess.js'
import { getWorkspaceId } from '../middleware/workspaceId.js'
import { defaultPermissionRegistry } from '../policy/index.js'
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
    const board = await deps.coverageProjection.board(workspace)
    const viewer = getViewerContext(context)
    const readsHandoffs = !viewer || defaultPermissionRegistry.can('handoff.read', viewer)
    return context.json(readsHandoffs ? board : withoutHandoffs(board), 200)
  })

  return router
}

/**
 * The board as somebody who may not read the queue sees it.
 *
 * Counting what is waiting is still reading the queue,
 * so the ids come off here rather than the surface being trusted
 * not to render them.
 * Every state stays, since what a document is still waiting on
 * is the board's whole point, and it names nobody's work.
 */
function withoutHandoffs(board: CoverageBoardType): CoverageBoardType {
  return {
    ...board,
    cards: board.cards.map(card => ({ ...card, proposalIds: [], clarificationIds: [] })),
    stages: board.stages.map(stage => ({
      ...stage,
      proposalIds: [],
      clarificationIds: [],
      answeredIds: [],
    })),
  }
}
