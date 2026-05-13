import type {
  SkillRegistry,
  SkillRunner,
  Workspace,
  WorkspaceRepository,
} from '@telos/core'
import type { SkillId } from '@telos/schema'
import { zValidator } from '@hono/zod-validator'
import { NotFoundError } from '@telos/core'
import { SkillId as SkillIdSchema, WorkspaceId } from '@telos/schema'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'

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
    const workspace = await loadWorkspaceForRequest(context.req.param('workspaceId'), deps.workspaceRepository)
    const manifests = await deps.skillRegistry.list(workspace)
    return context.json({
      items: manifests.map(manifest => manifest.toData()),
    })
  })

  router.get('/:skillId', async (context) => {
    const workspace = await loadWorkspaceForRequest(context.req.param('workspaceId'), deps.workspaceRepository)
    const skillId = SkillIdSchema.parse(context.req.param('skillId'))
    const manifest = await deps.skillRegistry.get(workspace, skillId)
    return context.json(manifest.toData())
  })

  router.post('/:skillId/run', zValidator('json', RunBodySchema), async (context) => {
    const workspace = await loadWorkspaceForRequest(context.req.param('workspaceId'), deps.workspaceRepository)
    const skillId = SkillIdSchema.parse(context.req.param('skillId'))
    const { args, resumeSessionId } = context.req.valid('json')

    return streamSSE(context, async (stream) => {
      const options = resumeSessionId ? { resumeSessionId } : undefined
      for await (const event of deps.skillRunner.run(workspace, skillId as SkillId, args, options)) {
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
        })
      }
    })
  })

  return router
}

async function loadWorkspaceForRequest(
  rawWorkspaceId: string | undefined,
  workspaceRepository: WorkspaceRepository,
): Promise<Workspace> {
  const workspaceId = WorkspaceId.parse(rawWorkspaceId)
  const workspaces = await workspaceRepository.list()
  const match = workspaces.find(workspace => workspace.id === workspaceId)
  if (!match) {
    throw new NotFoundError(`Workspace "${workspaceId}" not registered`)
  }
  return match
}
