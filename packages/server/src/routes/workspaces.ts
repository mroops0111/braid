import type { SourceLoaderRunner, Workspace, WorkspaceService } from '@braidhq/core'
import type { ProductManifest, SourceDescriptor } from '@braidhq/schema'
import { rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { NotFoundError, ValidationError } from '@braidhq/core'
import {
  AbsolutePath,
  AgentRoutingConfig,
  McpServerConfig,
  OntologyId,
  ProductManifestDraft,
  SourceDescriptor as SourceDescriptorSchema,
  SourceId,
  StorageDescriptor,
} from '@braidhq/schema'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { fillManifestDefaults, updateProductManifest, writeProductManifest } from '../infrastructure/fs/productManifestWriter.js'
import { getWorkspaceId, workspaceIdMiddleware } from '../middleware/workspaceId.js'

const RegisterBodySchema = z.object({
  rootPath: AbsolutePath,
})

const ScaffoldBodySchema = z.object({
  rootPath: AbsolutePath,
  manifest: ProductManifestDraft,
})

const PatchWorkspaceBodySchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  ontologyId: OntologyId.optional(),
  storage: StorageDescriptor.optional(),
  agents: AgentRoutingConfig.optional(),
  mcpServers: z.array(McpServerConfig).optional(),
}).refine(body => Object.keys(body).length > 0, { message: 'PATCH body must contain at least one field' })

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

  router.get('/:workspaceId', workspaceIdMiddleware, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const workspace = await deps.workspaceService.findById(workspaceId)
    return context.json(workspace.toData())
  })

  router.post('/', zValidator('json', RegisterBodySchema), async (context) => {
    const { rootPath } = context.req.valid('json')
    const workspace = await deps.workspaceService.load(rootPath)
    await deps.workspaceService.save(workspace)
    return context.json(workspace.toData(), 201)
  })

  // Create a workspace from scratch: write PRODUCT.md with server-filled
  // defaults, run every loader-backed source's `ingest`, then register.
  // If ingest fails (wrong git branch, missing OAuth scope, etc.) we
  // delete the PRODUCT.md we just wrote and drop the parse cache, so
  // the user's retry sees a clean slate instead of "PRODUCT.md already
  // exists" or a stale cached config.
  router.post('/scaffold', zValidator('json', ScaffoldBodySchema), async (context) => {
    const { rootPath, manifest: draft } = context.req.valid('json')
    const productPath = join(rootPath, 'PRODUCT.md')
    if (await pathExists(productPath))
      throw new ValidationError(`A PRODUCT.md already exists at "${rootPath}". Use POST /workspaces to register it instead.`)
    const manifest = fillManifestDefaults(draft)
    await writeProductManifest(rootPath, manifest, manifest.description)
    try {
      const workspace = await deps.workspaceService.load(rootPath)
      const ingestOutcomes = await deps.sourceLoaderRunner.ingestAll(workspace)
      await deps.workspaceService.save(workspace)
      return context.json({
        workspace: workspace.toData(),
        ingest: ingestOutcomes.map(o => ({ sourceId: o.sourceId, ...o.report })),
      }, 201)
    }
    catch (error) {
      await rm(productPath, { force: true })
      deps.workspaceService.invalidate(rootPath)
      throw error
    }
  })

  // Add a source to an existing workspace. Rewrites PRODUCT.md and runs
  // `ingest` if the source is loader-backed so the local filesystem is
  // populated before the user runs a skill against it.
  router.post('/:workspaceId/sources', workspaceIdMiddleware, zValidator('json', SourceDescriptorSchema), async (context) => {
    const workspaceId = getWorkspaceId(context)
    const source = context.req.valid('json') as SourceDescriptor
    const workspace = await deps.workspaceService.findById(workspaceId)
    if (workspace.findSource(source.name))
      throw new ValidationError(`Source "${source.name}" already exists in workspace "${workspaceId}"`)

    const nextManifest = withSources(workspace.productManifest, [...workspace.sources, source])
    await updateProductManifest(workspace.rootPath, nextManifest)
    const updated = await reload(deps.workspaceService, workspace.rootPath)

    let ingest: IngestSummary | undefined
    if (source.kind === 'filesystem' && source.loader) {
      const report = await deps.sourceLoaderRunner.syncOne(updated, source.id)
      ingest = { sourceId: source.id, ...report }
    }
    return context.json({ workspace: updated.toData(), ...(ingest ? { ingest } : {}) }, 201)
  })

  // Remove a source from the manifest. Local files (e.g. cloned git repos)
  // are left on disk; the user can `rm -rf` them manually if they want.
  router.delete('/:workspaceId/sources/:sourceId', workspaceIdMiddleware, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const sourceId = SourceId.parse(context.req.param('sourceId'))
    const workspace = await deps.workspaceService.findById(workspaceId)
    const source = workspace.sources.find(entry => entry.id === sourceId)
    if (!source)
      throw new NotFoundError(`Source "${sourceId}" not found in workspace "${workspaceId}"`)

    const nextManifest = withSources(workspace.productManifest, workspace.sources.filter(entry => entry.id !== sourceId))
    await updateProductManifest(workspace.rootPath, nextManifest)
    const updated = await reload(deps.workspaceService, workspace.rootPath)
    return context.json({ workspace: updated.toData() })
  })

  // Per-source sync. Looks up the source's loader and invokes `sync` (or
  // falls back to `ingest` if the destination doesn't exist yet).
  router.post('/:workspaceId/sources/:sourceId/sync', workspaceIdMiddleware, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const sourceId = SourceId.parse(context.req.param('sourceId'))
    const workspace = await deps.workspaceService.findById(workspaceId)
    const report = await deps.sourceLoaderRunner.syncOne(workspace, sourceId)
    return context.json(report)
  })

  // Update workspace-level manifest fields. Renaming changes the
  // WorkspaceId (derived from `manifest.name`) so callers should re-fetch
  // the workspace list after a successful rename.
  router.patch('/:workspaceId', workspaceIdMiddleware, zValidator('json', PatchWorkspaceBodySchema), async (context) => {
    const workspaceId = getWorkspaceId(context)
    const patch = context.req.valid('json')
    const workspace = await deps.workspaceService.findById(workspaceId)
    const nextManifest: ProductManifest = {
      ...workspace.productManifest,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.ontologyId !== undefined ? { ontologyId: patch.ontologyId } : {}),
      ...(patch.storage !== undefined ? { storage: patch.storage } : {}),
      ...(patch.agents !== undefined ? { agents: patch.agents } : {}),
      ...(patch.mcpServers !== undefined ? { mcpServers: patch.mcpServers } : {}),
    }
    await updateProductManifest(workspace.rootPath, nextManifest)
    const renamed = patch.name !== undefined && patch.name !== workspace.productManifest.name
    const updated = await reload(deps.workspaceService, workspace.rootPath)
    return context.json({
      workspace: updated.toData(),
      ...(renamed ? { renamed: true, previousId: workspace.id, newId: updated.id } : {}),
    })
  })

  // Unregister a workspace. Files (PRODUCT.md, .braid/, ingested sources)
  // are left on disk — the user can re-register via POST /workspaces or
  // delete the directory manually.
  router.delete('/:workspaceId', workspaceIdMiddleware, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const workspace = await deps.workspaceService.findById(workspaceId)
    await deps.workspaceService.remove(workspace.rootPath)
    return context.body(null, 204)
  })

  return router
}

interface IngestSummary {
  readonly sourceId: SourceId
  readonly changed: boolean
  readonly bytes?: number
  readonly fileCount?: number
  readonly revision?: string
  readonly notes?: readonly string[]
}

function withSources(manifest: ProductManifest, sources: readonly SourceDescriptor[]): ProductManifest {
  return { ...manifest, sources: [...sources] }
}

async function reload(workspaceService: WorkspaceService, rootPath: AbsolutePath): Promise<Workspace> {
  workspaceService.invalidate(rootPath)
  const reloaded = await workspaceService.load(rootPath)
  await workspaceService.save(reloaded)
  return reloaded
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
