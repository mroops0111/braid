import type { WorkspaceService } from '@telos/core'
import { zValidator } from '@hono/zod-validator'
import { AbsolutePath, WorkspaceId } from '@telos/schema'
import { Hono } from 'hono'
import { z } from 'zod'

const RegisterBodySchema = z.object({
  rootPath: AbsolutePath,
})

export interface WorkspacesRouterDeps {
  workspaceService: WorkspaceService
}

export function createWorkspacesRouter(deps: WorkspacesRouterDeps): Hono {
  const router = new Hono()

  router.get('/', async (context) => {
    const workspaces = await deps.workspaceService.list()
    return context.json({ items: workspaces.map(workspace => workspace.toData()) })
  })

  router.get('/:workspaceId', async (context) => {
    const workspaceId = WorkspaceId.parse(context.req.param('workspaceId'))
    const workspaces = await deps.workspaceService.list()
    const match = workspaces.find(workspace => workspace.id === workspaceId)
    if (!match) {
      return context.json(
        { type: 'about:blank', title: 'NotFoundError', status: 404, detail: `Workspace "${workspaceId}" not found`, code: 'TELOS-NOT-FOUND' },
        404,
        { 'Content-Type': 'application/problem+json' },
      )
    }
    return context.json(match.toData())
  })

  router.post('/', zValidator('json', RegisterBodySchema), async (context) => {
    const { rootPath } = context.req.valid('json')
    const workspace = await deps.workspaceService.load(rootPath)
    return context.json(workspace.toData(), 201)
  })

  return router
}
