import type { DecisionRepository } from '@braidhq/core'
import { DecisionAction, DecisionId } from '@braidhq/schema'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { getWorkspaceId } from '../middleware/workspaceId.js'
import { assertEntityInWorkspace } from './helpers.js'

const ListQuerySchema = z.object({
  action: z.union([DecisionAction, z.array(DecisionAction)]).optional(),
  limit: z.coerce.number().int().positive().optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
})

export interface DecisionsRouterDeps {
  decisionRepository: DecisionRepository
}

export function createDecisionsRouter(deps: DecisionsRouterDeps): Hono {
  const router = new Hono()

  router.get('/', zValidator('query', ListQuerySchema), async (context) => {
    const workspaceId = getWorkspaceId(context)
    const { action, limit, offset } = context.req.valid('query')
    const actions = action === undefined ? undefined : Array.isArray(action) ? action : [action]
    const decisions = await deps.decisionRepository.list({ workspaceId, actions, limit, offset })
    return context.json({ items: decisions })
  })

  router.get('/:decisionId', async (context) => {
    const workspaceId = getWorkspaceId(context)
    const decisionId = DecisionId.parse(context.req.param('decisionId'))
    const decision = await deps.decisionRepository.load(decisionId)
    assertEntityInWorkspace(workspaceId, decision.workspaceId, 'Decision', decisionId)
    return context.json(decision)
  })

  return router
}
