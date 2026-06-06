import type { SourceLoaderRunner, Workspace, WorkspaceBootstrap, WorkspaceService } from '@braidhq/core'
import type { ProductManifest, SourceDescriptor, Timestamp } from '@braidhq/schema'
import type { Context, MiddlewareHandler } from 'hono'
import type { WorkspaceRegistryFile } from '../infrastructure/fs/WorkspaceRegistryFile.js'
import type { UserRegistryFile } from '../infrastructure/users/UserRegistryFile.js'
import { rm } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
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
import { isUnder, pathExists } from '../infrastructure/fs/paths.js'
import { fillManifestDefaults, updateProductManifest, writeProductManifest } from '../infrastructure/fs/productManifestWriter.js'
import { getUserId } from '../middleware/userId.js'
import { requirePermission, requireServerCapability, workspaceAccessMiddleware } from '../middleware/workspaceAccess.js'
import { getWorkspaceId, workspaceIdMiddleware } from '../middleware/workspaceId.js'

const RegisterBodySchema = z.object({
  rootPath: AbsolutePath,
})

// Folder name resolved under the server-managed `workspacesRoot` (default
// `~/.braid/workspaces/`). Slug-only so name == folder == workspace id;
// rejects `/`, `..` and other path-traversal cases.
const WorkspaceFolderName = z.string().min(1).regex(
  /^[a-z0-9][a-z0-9-]*$/,
  'Workspace name must be lowercase letters, digits, or dashes; must start with a letter or digit.',
)

const ScaffoldBodySchema = z.object({
  name: WorkspaceFolderName,
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
  workspacesRoot: AbsolutePath
  bootstrap?: WorkspaceBootstrap
  /**
   * Optional: when present, `GET /workspaces` filters to ones the
   * current user is a member of, and newly registered workspaces
   * stamp the caller as owner. Absent in tests that don't exercise
   * membership.
   */
  workspaceRegistry?: WorkspaceRegistryFile
  /**
   * Optional: when present, server admins see every workspace
   * regardless of membership. Without this, only direct membership
   * controls visibility.
   */
  userRegistry?: UserRegistryFile
}

export function createWorkspacesRouter(deps: WorkspacesRouterDeps): Hono {
  const router = new Hono()

  // Server-scope gate (creation): admin-only. Skips when userRegistry
  // isn't provided so in-memory test compositions stay open.
  const serverCreate = requireServerCapability('workspace.create', deps.userRegistry)

  // Workspace-scope gate composed inline per :workspaceId route below.
  // `workspaceIdMiddleware` resolves the path param onto the context
  // before `workspaceAccessMiddleware` reads it; skipping when the
  // registries are absent keeps in-memory test compositions open.
  const wsAccess = (deps.workspaceRegistry && deps.userRegistry)
    ? workspaceAccessMiddleware({
        registry: deps.workspaceRegistry,
        workspaceService: deps.workspaceService,
        userRegistry: deps.userRegistry,
      })
    : (async (_c: Context, next: () => Promise<void>) => { await next() }) as MiddlewareHandler

  router.get('/', async (context) => {
    const all = await deps.workspaceService.list()
    if (!deps.workspaceRegistry)
      return context.json({ items: all.map(workspace => workspace.toData()) })
    // Server admins see every workspace for support / oversight. Other
    // users get filtered to direct membership. Single-tenant local
    // installs see everything because (a) local-user has serverRole
    // 'admin' and (b) the migration seeded local-user as owner.
    const userId = getUserId(context)
    const me = await deps.userRegistry?.get(userId)
    if (me?.serverRole === 'admin')
      return context.json({ items: all.map(workspace => workspace.toData()) })
    const visible: Workspace[] = []
    for (const workspace of all) {
      const member = await deps.workspaceRegistry.getMember(workspace.rootPath, userId)
      if (member)
        visible.push(workspace)
    }
    return context.json({ items: visible.map(workspace => workspace.toData()) })
  })

  router.get('/:workspaceId', workspaceIdMiddleware, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const workspace = await deps.workspaceService.findById(workspaceId)
    return context.json(workspace.toData())
  })

  router.post('/', serverCreate, zValidator('json', RegisterBodySchema), async (context) => {
    const { rootPath } = context.req.valid('json')
    const workspace = await deps.workspaceService.load(rootPath)
    await deps.workspaceService.save(workspace)
    await deps.bootstrap?.ensure(workspace)
    await ensureCallerOwner(deps.workspaceRegistry, workspace.rootPath, getUserId(context))
    return context.json(workspace.toData(), 201)
  })

  // Create-only entrypoint. Existing canonical workspaces are surfaced
  // via the sidebar (auto-discovered on boot), so the wizard never has
  // to double-purpose as "open". Conflict on submit means "pick a
  // different name or delete the existing one first". The response is
  // a 400 the UI can humanise.
  //
  // Writes PRODUCT.md with server-filled defaults, runs every
  // loader-backed source's `ingest`, then registers. If ingest fails
  // (wrong git branch, missing OAuth scope, etc.) we delete the
  // PRODUCT.md we just wrote and drop the parse cache, so the user's
  // retry sees a clean slate instead of a stale half-created workspace.
  router.post('/scaffold', serverCreate, zValidator('json', ScaffoldBodySchema), async (context) => {
    const { name, manifest: draft } = context.req.valid('json')
    const rootPath = join(deps.workspacesRoot, name) as AbsolutePath
    const productPath = join(rootPath, 'PRODUCT.md')

    if (await pathExists(productPath)) {
      throw new ValidationError(
        `A workspace named "${name}" already exists. Open it from the sidebar, or delete it first to recreate with the same name.`,
      )
    }

    const manifest = fillManifestDefaults(draft)
    await writeProductManifest(rootPath, manifest, manifest.description)
    try {
      const workspace = await deps.workspaceService.load(rootPath)
      const ingestOutcomes = await deps.sourceLoaderRunner.ingestAll(workspace)
      await deps.workspaceService.save(workspace)
      await deps.bootstrap?.ensure(workspace)
      await ensureCallerOwner(deps.workspaceRegistry, workspace.rootPath, getUserId(context))
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
  router.post('/:workspaceId/sources', workspaceIdMiddleware, wsAccess, requirePermission('workspace.write'), zValidator('json', SourceDescriptorSchema), async (context) => {
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

  // Remove a source from the manifest AND rm its local files when the
  // resolved path is inside the workspace folder (typical case: relative
  // `./intent` etc.: safe to wipe, the loader was their author). If the
  // source's path is absolute and points outside the workspace, files
  // are kept and an explanatory note returned; we won't nuke a
  // directory the user could plausibly own outside Braid's scope.
  router.delete('/:workspaceId/sources/:sourceId', workspaceIdMiddleware, wsAccess, requirePermission('workspace.write'), async (context) => {
    const workspaceId = getWorkspaceId(context)
    const sourceId = SourceId.parse(context.req.param('sourceId'))
    const workspace = await deps.workspaceService.findById(workspaceId)
    const source = workspace.sources.find(entry => entry.id === sourceId)
    if (!source)
      throw new NotFoundError(`Source "${sourceId}" not found in workspace "${workspaceId}"`)

    const nextManifest = withSources(workspace.productManifest, workspace.sources.filter(entry => entry.id !== sourceId))
    await updateProductManifest(workspace.rootPath, nextManifest)

    let filesRemoved = false
    if (source.kind === 'filesystem') {
      const resolved = isAbsolute(source.path) ? source.path : resolve(workspace.rootPath, source.path)
      if (isUnder(resolved, workspace.rootPath) && resolved !== workspace.rootPath) {
        await rm(resolved, { recursive: true, force: true })
        filesRemoved = true
      }
    }

    const updated = await reload(deps.workspaceService, workspace.rootPath)
    return context.json({ workspace: updated.toData(), filesRemoved })
  })

  // Per-source sync. Looks up the source's loader and invokes `sync` (or
  // falls back to `ingest` if the destination doesn't exist yet).
  router.post('/:workspaceId/sources/:sourceId/sync', workspaceIdMiddleware, wsAccess, requirePermission('workspace.write'), async (context) => {
    const workspaceId = getWorkspaceId(context)
    const sourceId = SourceId.parse(context.req.param('sourceId'))
    const workspace = await deps.workspaceService.findById(workspaceId)
    const report = await deps.sourceLoaderRunner.syncOne(workspace, sourceId)
    return context.json(report)
  })

  // Update workspace-level manifest fields. Renaming changes the
  // WorkspaceId (derived from `manifest.name`) so callers should re-fetch
  // the workspace list after a successful rename.
  router.patch('/:workspaceId', workspaceIdMiddleware, wsAccess, requirePermission('workspace.write'), zValidator('json', PatchWorkspaceBodySchema), async (context) => {
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

  // Unregister a workspace (default) or fully delete it (`?purge=true`).
  //
  // Without `purge`, files (PRODUCT.md, .braid/, ingested sources) stay
  // on disk. But canonical-root workspaces under `<workspacesRoot>/` get
  // re-registered by `discoverCanonicalWorkspaces` on the next server
  // boot, so plain unregister is effectively a no-op for them. That's
  // why purge exists.
  //
  // `purge=true` also `rm -rf`'s the workspace folder. Refused for
  // arbitrary-path workspaces (registered via `POST /workspaces` with a
  // custom rootPath) since we shouldn't nuke directories Braid didn't
  // create. The user can rm those manually if they want.
  router.delete('/:workspaceId', workspaceIdMiddleware, wsAccess, requirePermission('workspace.write'), async (context) => {
    const workspaceId = getWorkspaceId(context)
    const purge = context.req.query('purge') === 'true'
    const workspace = await deps.workspaceService.findById(workspaceId)
    if (purge && !isUnder(workspace.rootPath, deps.workspacesRoot)) {
      throw new ValidationError(
        `Refusing to purge workspace "${workspaceId}": its rootPath "${workspace.rootPath}" `
        + `lives outside the canonical workspaces root. Unregister without purge and remove the directory manually.`,
      )
    }
    await deps.workspaceService.remove(workspace.rootPath)
    if (purge)
      await rm(workspace.rootPath, { recursive: true, force: true })
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

/**
 * Idempotently stamp the caller as owner of a freshly registered
 * workspace. If members[] already contains an owner (workspace was
 * re-registered, or the migration already touched it) this is a no-op.
 */
async function ensureCallerOwner(
  registry: WorkspaceRegistryFile | undefined,
  rootPath: AbsolutePath,
  userId: ReturnType<typeof getUserId>,
): Promise<void> {
  if (!registry)
    return
  const members = await registry.listMembers(rootPath)
  if (members.length > 0)
    return
  await registry.addMember(rootPath, {
    userId,
    role: 'owner',
    joinedAt: new Date().toISOString() as Timestamp,
  })
}
