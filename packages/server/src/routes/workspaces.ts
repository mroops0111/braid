import type { SourceLoaderRunner, WorkspaceService } from '@telos/core'
import { zValidator } from '@hono/zod-validator'
import { NotFoundError } from '@telos/core'
import { AbsolutePath, SourceId, WorkspaceId } from '@telos/schema'
import { Hono } from 'hono'
import { z } from 'zod'

const RegisterBodySchema = z.object({
  rootPath: AbsolutePath,
})

export interface WorkspacesRouterDeps {
  workspaceService: WorkspaceService
  sourceLoaderRunner: SourceLoaderRunner
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
    await deps.workspaceService.save(workspace)
    return context.json(workspace.toData(), 201)
  })

  // Per-source sync. Looks up the source's loader and invokes `sync` (or
  // falls back to `ingest` if the loader doesn't implement sync).
  // Loader-less sources return 400 — there's nothing to do.
  router.post('/:workspaceId/sources/:sourceId/sync', async (context) => {
    const workspaceId = WorkspaceId.parse(context.req.param('workspaceId'))
    const sourceId = SourceId.parse(context.req.param('sourceId'))
    const workspaces = await deps.workspaceService.list()
    const workspace = workspaces.find(ws => ws.id === workspaceId)
    if (!workspace)
      throw new NotFoundError(`Workspace "${workspaceId}" not registered`)
    const report = await deps.sourceLoaderRunner.syncOne(workspace, sourceId)
    return context.json(report)
  })

  return router
}
