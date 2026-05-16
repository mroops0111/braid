import type {
  SkillRegistry,
  SkillRunner,
  WorkspaceRepository,
} from '@braidhq/core'
import type { SkillId } from '@braidhq/schema'
import { SkillId as SkillIdSchema } from '@braidhq/schema'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { getWorkspaceId } from '../middleware/workspaceId.js'
import { loadWorkspaceById } from './helpers.js'

const RunBodySchema = z.object({
  args: z.string().default(''),
  /** Continue an existing claude conversation (from a prior session-started event). */
  resumeSessionId: z.string().min(1).optional(),
})

export interface SkillsRouterDeps {
  readonly skillRegistry: SkillRegistry
  readonly skillRunner: SkillRunner
  readonly workspaceRepository: WorkspaceRepository
}

export function createSkillsRouter(deps: SkillsRouterDeps): Hono {
  const router = new Hono()

  router.get('/', async (context) => {
    const workspace = await loadWorkspaceById(getWorkspaceId(context), deps.workspaceRepository)
    const manifests = await deps.skillRegistry.list(workspace)
    return context.json({
      items: manifests.map(manifest => manifest.toData()),
    })
  })

  router.get('/:skillId', async (context) => {
    const workspace = await loadWorkspaceById(getWorkspaceId(context), deps.workspaceRepository)
    const skillId = SkillIdSchema.parse(context.req.param('skillId'))
    const manifest = await deps.skillRegistry.get(workspace, skillId)
    return context.json(manifest.toData())
  })

  // Fire-and-forget run. The subprocess + event drain runs in the background;
  // events are persisted to JSONL and broadcast to subscribers regardless of
  // whether the client stays connected. The client tails progress via
  // `GET /workspaces/:ws/runs/:runId/events`, which can be opened and closed
  // freely without affecting the run.
  router.post('/:skillId/run', zValidator('json', RunBodySchema), async (context) => {
    const workspace = await loadWorkspaceById(getWorkspaceId(context), deps.workspaceRepository)
    const skillId = SkillIdSchema.parse(context.req.param('skillId'))
    const { args, resumeSessionId } = context.req.valid('json')
    const options = resumeSessionId ? { resumeSessionId } : undefined
    const runId = await deps.skillRunner.start(workspace, skillId as SkillId, args, options)
    return context.json({ runId }, 202)
  })

  return router
}
