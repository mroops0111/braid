import type { SourceLoaderRunner, WorkspaceService } from '@telos/core'
import { stat } from 'node:fs/promises'
import { zValidator } from '@hono/zod-validator'
import { NotFoundError, ValidationError } from '@telos/core'
import { AbsolutePath, ProductManifestDraft, SourceId, WorkspaceId } from '@telos/schema'
import { Hono } from 'hono'
import { z } from 'zod'
import { fillManifestDefaults, writeProductManifest } from '../infrastructure/fs/productManifestWriter.js'

const RegisterBodySchema = z.object({
  rootPath: AbsolutePath,
})

const ScaffoldBodySchema = z.object({
  rootPath: AbsolutePath,
  manifest: ProductManifestDraft,
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

  // Create a workspace from scratch: write PRODUCT.md with server-filled
  // defaults, register it, and run every loader-backed source's `ingest`
  // so the local filesystem is hydrated by the time the user can run a
  // skill. Refuses to overwrite an existing PRODUCT.md — the user can
  // call `POST /workspaces` instead to register what's already there.
  router.post('/scaffold', zValidator('json', ScaffoldBodySchema), async (context) => {
    const { rootPath, manifest: draft } = context.req.valid('json')
    if (await pathExists(`${rootPath}/PRODUCT.md`))
      throw new ValidationError(`A PRODUCT.md already exists at "${rootPath}". Use POST /workspaces to register it instead.`)
    const manifest = fillManifestDefaults(draft)
    await writeProductManifest(rootPath, manifest, manifest.description)
    const workspace = await deps.workspaceService.load(rootPath)
    await deps.workspaceService.save(workspace)
    const ingestOutcomes = await deps.sourceLoaderRunner.ingestAll(workspace)
    return context.json({
      workspace: workspace.toData(),
      ingest: ingestOutcomes.map(o => ({ sourceId: o.sourceId, ...o.report })),
    }, 201)
  })

  // Per-source sync. Looks up the source's loader and invokes `sync` (or
  // falls back to `ingest` if the destination doesn't exist yet).
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  }
  catch {
    return false
  }
}
