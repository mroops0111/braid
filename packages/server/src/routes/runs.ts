import type {
  RunRepository,
  SkillRunner,
  Workspace,
  WorkspaceRepository,
} from '@telos/core'
import { NotFoundError } from '@telos/core'
import { SkillRunId, WorkspaceId } from '@telos/schema'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'

export interface RunsRouterDeps {
  readonly runRepository: RunRepository
  readonly skillRunner: SkillRunner
  readonly workspaceRepository: WorkspaceRepository
}

export function createRunsRouter(deps: RunsRouterDeps): Hono {
  const router = new Hono()

  router.get('/', async (context) => {
    const workspace = await loadWorkspaceForRequest(context.req.param('workspaceId'), deps.workspaceRepository)
    const items = await deps.runRepository.listRecords(workspace)
    return context.json({ items })
  })

  router.get('/:runId/events', async (context) => {
    const workspace = await loadWorkspaceForRequest(context.req.param('workspaceId'), deps.workspaceRepository)
    const runId = SkillRunId.parse(context.req.param('runId'))
    return streamSSE(context, async (stream) => {
      for await (const event of deps.runRepository.readEvents(workspace, runId)) {
        await stream.writeSSE({ event: event.type, data: JSON.stringify(event) })
      }
    })
  })

  router.delete('/sessions/:sessionId', async (context) => {
    const sessionId = context.req.param('sessionId')
    if (!sessionId)
      throw new NotFoundError('sessionId is required')
    await deps.skillRunner.forgetSession(sessionId)
    return context.body(null, 204)
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
  if (!match)
    throw new NotFoundError(`Workspace "${workspaceId}" not registered`)
  return match
}
