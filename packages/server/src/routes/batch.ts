import type { BatchService, PluginRegistry, SkillRegistry, WorkspaceRepository } from '@braidhq/core'
import { NotFoundError } from '@braidhq/core'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { extractBearerToken, getUserId } from '../middleware/auth.js'
import { requirePermission } from '../middleware/workspaceAccess.js'
import { getWorkspaceId } from '../middleware/workspaceId.js'
import { loadWorkspaceById, resolvePerUnitSkillId } from './helpers.js'

const StartBody = z.object({
  autoApply: z.boolean(),
  // Absent walks every document. Present walks only these,
  // which is how a board column covers what it holds without a second run.
  scope: z.array(z.string().min(1)).min(1).optional(),
})

export interface BatchRouterDeps {
  batchService: BatchService
  workspaceRepository: WorkspaceRepository
  skillRegistry: SkillRegistry
  pluginRegistry: PluginRegistry
}

export function createBatchRouter(deps: BatchRouterDeps): Hono {
  const router = new Hono()

  // A batch is the per-unit skill run many times over,
  // so whoever may run that skill may drive the batch, and nobody else.
  // Reading the plan is left open, since it is the same standing
  // the coverage board already gives every member.
  router.on('POST', ['/', '/stop', '/resume', '/archive'], requirePermission('skill.run', async (context) => {
    const workspace = await loadWorkspaceById(getWorkspaceId(context), deps.workspaceRepository)
    const skillId = resolvePerUnitSkillId(deps.pluginRegistry, workspace)
    if (!skillId)
      return undefined
    const manifest = await deps.skillRegistry.get(workspace, skillId)
    return { skill: manifest.toData().frontmatter, skillId }
  }))

  router.post('/', zValidator('json', StartBody), async (context) => {
    const workspaceId = getWorkspaceId(context)
    const { autoApply, scope } = context.req.valid('json')
    const callerToken = extractBearerToken(context)
    const plan = await deps.batchService.start(workspaceId, {
      autoApply,
      ...(scope ? { scope } : {}),
      startedBy: getUserId(context),
      ...(callerToken ? { callerToken } : {}),
    })
    return context.json(plan.toData(), 202)
  })

  router.get('/', async (context) => {
    const workspaceId = getWorkspaceId(context)
    const plan = await deps.batchService.getStatus(workspaceId)
    if (!plan)
      throw new NotFoundError(`No batch plan for workspace ${workspaceId}`)
    return context.json(plan.toData())
  })

  router.post('/stop', async (context) => {
    const workspaceId = getWorkspaceId(context)
    await deps.batchService.stop(workspaceId)
    return context.body(null, 204)
  })

  router.post('/resume', async (context) => {
    const workspaceId = getWorkspaceId(context)
    const callerToken = extractBearerToken(context)
    const plan = await deps.batchService.resume(workspaceId, {
      startedBy: getUserId(context),
      ...(callerToken ? { callerToken } : {}),
    })
    return context.json(plan.toData(), 202)
  })

  router.post('/archive', async (context) => {
    const workspaceId = getWorkspaceId(context)
    const plan = await deps.batchService.archive(workspaceId)
    return context.json(plan.toData())
  })

  return router
}
