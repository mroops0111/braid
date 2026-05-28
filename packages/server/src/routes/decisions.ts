import type { DecisionRepository } from '@braidhq/core'
import { Decision, DecisionAction, DecisionId } from '@braidhq/schema'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { getWorkspaceId } from '../middleware/workspaceId.js'
import { NotFoundResponse, ValidationFailureResponse, WorkspaceIdParam } from './_shared.js'
import { assertEntityInWorkspace } from './helpers.js'

const ListQuery = z.object({
  action: z.union([DecisionAction, z.array(DecisionAction)]).optional().openapi({ description: 'Filter by decision action; pass one or many.' }),
  limit: z.coerce.number().int().positive().optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
})

const DecisionIdParam = WorkspaceIdParam.extend({
  decisionId: DecisionId.openapi({ param: { name: 'decisionId', in: 'path' } }),
})

const DecisionListResponse = z.object({
  items: z.array(Decision),
}).openapi('DecisionListResponse')

export interface DecisionsRouterDeps {
  decisionRepository: DecisionRepository
}

const listDecisionsRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listDecisions',
  summary: 'List apply / reject / answer / skip decisions for a workspace.',
  tags: ['decisions'],
  request: {
    params: WorkspaceIdParam,
    query: ListQuery,
  },
  responses: {
    200: {
      description: 'A page of matching decisions.',
      content: { 'application/json': { schema: DecisionListResponse } },
    },
    400: ValidationFailureResponse,
  },
})

const getDecisionRoute = createRoute({
  method: 'get',
  path: '/{decisionId}',
  operationId: 'getDecision',
  summary: 'Fetch a single decision by id.',
  tags: ['decisions'],
  request: { params: DecisionIdParam },
  responses: {
    200: {
      description: 'The requested decision.',
      content: { 'application/json': { schema: Decision } },
    },
    404: NotFoundResponse,
  },
})

export function createDecisionsRouter(deps: DecisionsRouterDeps): OpenAPIHono {
  const router = new OpenAPIHono()

  router.openapi(listDecisionsRoute, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const { action, limit, offset } = context.req.valid('query')
    const actions = action === undefined ? undefined : Array.isArray(action) ? action : [action]
    const decisions = await deps.decisionRepository.list({ workspaceId, actions, limit, offset })
    return context.json({ items: decisions }, 200)
  })

  router.openapi(getDecisionRoute, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const { decisionId } = context.req.valid('param')
    const decision = await deps.decisionRepository.load(decisionId)
    assertEntityInWorkspace(workspaceId, decision.workspaceId, 'Decision', decisionId)
    return context.json(decision, 200)
  })

  return router
}
