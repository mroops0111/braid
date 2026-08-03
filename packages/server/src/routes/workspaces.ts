import type { HistoryService, PluginRegistry, SourceLoaderRunner, WorkspaceBootstrapService, WorkspaceService } from '@braidhq/core'
import type { AbsolutePath, ProductManifest, SourceDescriptor, SourceId as SourceIdType, Timestamp, UserId, WorkspaceId } from '@braidhq/schema'
import type { Context, MiddlewareHandler } from 'hono'
import type { UserRegistryFile } from '../infrastructure/users/UserRegistryFile.js'
import type { WorkspaceRegistryFile } from '../infrastructure/workspace/WorkspaceRegistryFile.js'
import { rm } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { NotFoundError, ValidationError, Workspace } from '@braidhq/core'
import {
  McpServerConfig,
  McpServerId,
  OntologyId,
  ProductManifestCreate,
  SourceDescriptor as SourceDescriptorSchema,
  SourceId,
  StorageDescriptor,
} from '@braidhq/schema'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { isUnder, pathExists } from '../infrastructure/_shared/paths.js'
import { fillManifestDefaults, updateProductManifest, writeProductManifest } from '../infrastructure/workspace/productManifestWriter.js'
import { getUserId } from '../middleware/auth.js'
import { requirePermission, requireServerCapability, workspaceAccessMiddleware } from '../middleware/workspaceAccess.js'
import { getWorkspaceId, workspaceIdMiddleware } from '../middleware/workspaceId.js'

// Folder name resolved under the server-managed `workspacesRoot`,
// default `~/.braid/workspaces/`.
// Slug-only so name == folder == workspace id.
// Rejects `/`, `..` and other path-traversal cases.
const WorkspaceFolderName = z.string().min(1).regex(
  /^[a-z0-9][a-z0-9-]*$/,
  'Workspace name must be lowercase letters, digits, or dashes; must start with a letter or digit.',
)

const ScaffoldBodySchema = z.object({
  name: WorkspaceFolderName,
  manifest: ProductManifestCreate,
})

const PatchWorkspaceBodySchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  ontologyId: OntologyId.optional(),
  storage: StorageDescriptor.optional(),
  mcpServers: z.array(McpServerConfig).optional(),
}).refine(body => Object.keys(body).length > 0, { message: 'PATCH body must contain at least one field' })

// Per-item PATCH bodies. An empty string for `description` clears the field,
// absent means leave as-is.
const PatchSourceBodySchema = z.object({
  description: z.string().optional(),
}).refine(body => Object.keys(body).length > 0, { message: 'PATCH body must contain at least one field' })

const PatchMcpServerBodySchema = z.object({
  description: z.string().optional(),
}).refine(body => Object.keys(body).length > 0, { message: 'PATCH body must contain at least one field' })

export interface WorkspacesRouterDeps {
  workspaceService: WorkspaceService
  sourceLoaderRunner: SourceLoaderRunner
  workspacesRoot: AbsolutePath
  /**
   * Used at scaffold time to look up the chosen ontology,
   * and validate that the manifest carries every role it requires.
   */
  pluginRegistry: PluginRegistry
  bootstrap?: WorkspaceBootstrapService
  /**
   * Optional. When present, `GET /workspaces` filters to member ones,
   * and newly registered workspaces stamp the caller as owner.
   * Absent in tests that don't exercise membership.
   */
  workspaceRegistry?: WorkspaceRegistryFile
  /**
   * Optional. When present, server admins see every workspace,
   * regardless of membership.
   * Without this, only direct membership controls visibility.
   */
  userRegistry?: UserRegistryFile
  /**
   * Optional. When present, manifest edits (sources, mcp servers,
   * workspace fields) commit as their own `config` entry,
   * instead of riding along on the next unrelated commit.
   * Absent in tests without git.
   */
  historyService?: HistoryService
}

// Commit a PRODUCT.md edit as its own `config` history entry.
// No-op without a wired historyService, as in in-memory tests.
async function commitConfigChange(
  deps: WorkspacesRouterDeps,
  workspaceId: WorkspaceId,
  userId: UserId,
  subject: string,
  sourceId?: SourceIdType,
): Promise<void> {
  await deps.historyService?.commitWorkspaceChange(workspaceId, {
    kind: 'config',
    subject: subject.slice(0, 120),
    userId,
    ...(sourceId ? { sourceId } : {}),
  })
}

export function createWorkspacesRouter(deps: WorkspacesRouterDeps): Hono {
  const router = new Hono()

  // Server-scope gate for creation, admin-only.
  // Skips without userRegistry, so in-memory tests stay open.
  const serverCreate = requireServerCapability('workspace.create', deps.userRegistry)

  // Workspace-scope gate composed inline per :workspaceId route below.
  // `workspaceIdMiddleware` resolves the path param onto the context,
  // before `workspaceAccessMiddleware` reads it.
  // Skipping without the registries keeps in-memory tests open.
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
    // Server admins see every workspace for support and oversight.
    // Other users get filtered to direct membership.
    // Single-tenant local installs see everything,
    // local-user is an admin owner seeded by the migration.
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

  // Create-only entrypoint. Existing workspaces are auto-discovered on boot,
  // surfaced in the sidebar, so the wizard never doubles as "open".
  // A conflict on submit is a 400 the UI can humanise,
  // "pick a different name, or delete the existing one first".
  //
  // Writes PRODUCT.md with server-filled defaults,
  // runs every loader-backed source's `provision`, then registers.
  // If provisioning fails, for example a bad git branch or scope,
  // we delete the PRODUCT.md just written and drop the parse cache,
  // so the retry sees a clean slate, not a stale half-created workspace.
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
    // Each ontology declares which source roles it needs to function.
    // Reject scaffolds that omit a role the ontology declares required,
    // before any writes, so the wizard can show a precise "you also need
    // a source of role x", rather than a post-scaffold validation error.
    const ontology = deps.pluginRegistry.findOntology(manifest.ontologyId)
    const requiredRoles = (ontology?.sourceRoles ?? []).filter(role => role.required).map(role => role.id)
    if (requiredRoles.length > 0) {
      const presentRoles = new Set(manifest.sources.map(s => s.role))
      const missing = requiredRoles.filter(r => !presentRoles.has(r))
      if (missing.length > 0) {
        throw new ValidationError(
          `Workspace requires source role${missing.length === 1 ? '' : 's'} ${missing.map(r => `"${r}"`).join(', ')} `
          + `for ontology "${manifest.ontologyId}". Add a source of each role before creating the workspace.`,
        )
      }
    }
    await writeProductManifest(rootPath, manifest, manifest.description)
    try {
      const workspace = await deps.workspaceService.load(rootPath)
      const provisionOutcomes = await deps.sourceLoaderRunner.provisionAll(workspace)
      await deps.workspaceService.save(workspace)
      await deps.bootstrap?.ensure(workspace)
      await ensureCallerOwner(deps.workspaceRegistry, workspace.rootPath, getUserId(context))
      return context.json({
        workspace: workspace.toData(),
        provision: provisionOutcomes.map(o => ({ sourceId: o.sourceId, ...o.report })),
      }, 201)
    }
    catch (error) {
      await rm(productPath, { force: true })
      deps.workspaceService.invalidate(rootPath)
      throw error
    }
  })

  // Add a source to an existing workspace. Rewrites PRODUCT.md,
  // and runs `provision` if the source is loader-backed,
  // so the local filesystem is populated before a skill runs on it.
  router.post('/:workspaceId/sources', workspaceIdMiddleware, wsAccess, requirePermission('workspace.write'), zValidator('json', SourceDescriptorSchema), async (context) => {
    const workspaceId = getWorkspaceId(context)
    const source = context.req.valid('json') as SourceDescriptor
    const workspace = await deps.workspaceService.findById(workspaceId)
    if (workspace.findSource(source.name))
      throw new ValidationError(`Source "${source.name}" already exists in workspace "${workspaceId}"`)

    const nextManifest = withSources(workspace.productManifest, [...workspace.sources, source])
    await updateProductManifest(workspace.rootPath, nextManifest)
    await commitConfigChange(deps, workspaceId, getUserId(context), `added source ${source.name}`, source.id)
    const updated = await reload(deps.workspaceService, workspace.rootPath)

    let provision: ProvisionSummary | undefined
    if (source.kind === 'filesystem' && source.loader) {
      const report = await deps.sourceLoaderRunner.syncOne(updated, source.id)
      provision = { sourceId: source.id, ...report }
    }
    return context.json({ workspace: updated.toData(), ...(provision ? { provision } : {}) }, 201)
  })

  // Remove a source from the manifest,
  // and rm its local files when the resolved path is inside the folder.
  // A relative path like `./intent` is safe to wipe, the loader made it.
  // An absolute path outside the workspace keeps its files,
  // returning a note instead.
  // We won't nuke a directory the user could plausibly own outside Braid.
  router.delete('/:workspaceId/sources/:sourceId', workspaceIdMiddleware, wsAccess, requirePermission('workspace.write'), async (context) => {
    const workspaceId = getWorkspaceId(context)
    const sourceId = SourceId.parse(context.req.param('sourceId'))
    const workspace = await deps.workspaceService.findById(workspaceId)
    const source = workspace.sources.find(entry => entry.id === sourceId)
    if (!source)
      throw new NotFoundError(`Source "${sourceId}" not found in workspace "${workspaceId}"`)

    const nextManifest = withSources(workspace.productManifest, workspace.sources.filter(entry => entry.id !== sourceId))
    deps.workspaceService.assertRequiredSourceRoles(new Workspace({ ...workspace.toData(), productManifest: nextManifest }))
    await updateProductManifest(workspace.rootPath, nextManifest)
    await commitConfigChange(deps, workspaceId, getUserId(context), `removed source ${source.name}`, sourceId)

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

  // Edit a source's editable metadata, description for now.
  // Structural fields (id, kind, path, role) are immutable,
  // to keep cross-references and on-disk layout stable.
  // A rename or loader-change flow would need its own migration story.
  router.patch('/:workspaceId/sources/:sourceId', workspaceIdMiddleware, wsAccess, requirePermission('workspace.write'), zValidator('json', PatchSourceBodySchema), async (context) => {
    const workspaceId = getWorkspaceId(context)
    const sourceId = SourceId.parse(context.req.param('sourceId'))
    const patch = context.req.valid('json')
    const workspace = await deps.workspaceService.findById(workspaceId)
    const existing = workspace.sources.find(entry => entry.id === sourceId)
    if (!existing)
      throw new NotFoundError(`Source "${sourceId}" not found in workspace "${workspaceId}"`)

    const patched: SourceDescriptor = patch.description === ''
      ? stripField(existing, 'description')
      : { ...existing, ...(patch.description !== undefined ? { description: patch.description } : {}) }
    const nextManifest = withSources(workspace.productManifest, workspace.sources.map(s => (s.id === sourceId ? patched : s)))
    await updateProductManifest(workspace.rootPath, nextManifest)
    await commitConfigChange(deps, workspaceId, getUserId(context), `updated source ${existing.name}`, sourceId)
    const updated = await reload(deps.workspaceService, workspace.rootPath)
    return context.json({ workspace: updated.toData() })
  })

  // Edit an MCP server's editable metadata.
  // URL, transport, and headers stay editable via the workspace PATCH,
  // which expects the whole mcpServers[] array.
  // This endpoint is only for the per-server description field,
  // so Studio doesn't need to send the whole list.
  router.patch('/:workspaceId/mcpServers/:mcpServerId', workspaceIdMiddleware, wsAccess, requirePermission('workspace.write'), zValidator('json', PatchMcpServerBodySchema), async (context) => {
    const workspaceId = getWorkspaceId(context)
    const mcpServerId = McpServerId.parse(context.req.param('mcpServerId'))
    const patch = context.req.valid('json')
    const workspace = await deps.workspaceService.findById(workspaceId)
    const existing = workspace.productManifest.mcpServers.find(s => s.id === mcpServerId)
    if (!existing)
      throw new NotFoundError(`MCP server "${mcpServerId}" not found in workspace "${workspaceId}"`)

    const patched = patch.description === ''
      ? stripField(existing, 'description')
      : { ...existing, ...(patch.description !== undefined ? { description: patch.description } : {}) }
    const nextManifest: ProductManifest = {
      ...workspace.productManifest,
      mcpServers: workspace.productManifest.mcpServers.map(s => (s.id === mcpServerId ? patched : s)),
    }
    await updateProductManifest(workspace.rootPath, nextManifest)
    await commitConfigChange(deps, workspaceId, getUserId(context), `updated mcp server ${mcpServerId}`)
    const updated = await reload(deps.workspaceService, workspace.rootPath)
    return context.json({ workspace: updated.toData() })
  })

  // Per-source sync. Looks up the source's loader and invokes `sync`,
  // or falls back to `provision` if the destination doesn't exist yet.
  router.post('/:workspaceId/sources/:sourceId/sync', workspaceIdMiddleware, wsAccess, requirePermission('workspace.write'), async (context) => {
    const workspaceId = getWorkspaceId(context)
    const sourceId = SourceId.parse(context.req.param('sourceId'))
    const workspace = await deps.workspaceService.findById(workspaceId)
    const report = await deps.sourceLoaderRunner.syncOne(workspace, sourceId)
    return context.json(report)
  })

  // Update workspace-level manifest fields.
  // Renaming changes the WorkspaceId, derived from `manifest.name`,
  // so callers should re-fetch the workspace list after a rename.
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
      ...(patch.mcpServers !== undefined ? { mcpServers: patch.mcpServers } : {}),
    }
    await updateProductManifest(workspace.rootPath, nextManifest)
    const renamed = patch.name !== undefined && patch.name !== workspace.productManifest.name
    await commitConfigChange(deps, workspaceId, getUserId(context), renamed ? `renamed to ${patch.name}` : 'updated workspace config')
    const updated = await reload(deps.workspaceService, workspace.rootPath)
    return context.json({
      workspace: updated.toData(),
      ...(renamed ? { renamed: true, previousId: workspace.id, newId: updated.id } : {}),
    })
  })

  // `purge=true` rm -rf's the folder. Without it,
  // discoverCanonicalWorkspaces re-registers on next boot.
  router.delete('/:workspaceId', workspaceIdMiddleware, wsAccess, requirePermission('workspace.write'), async (context) => {
    const workspaceId = getWorkspaceId(context)
    const purge = context.req.query('purge') === 'true'
    const workspace = await deps.workspaceService.findById(workspaceId)
    await deps.workspaceService.remove(workspace.rootPath)
    if (purge)
      await rm(workspace.rootPath, { recursive: true, force: true })
    return context.body(null, 204)
  })

  return router
}

interface ProvisionSummary {
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

// Returns a copy of `entry` without the named optional field.
// Honours the explicit "clear" signal in PATCH bodies (description='').
function stripField<T extends Record<string, unknown>, K extends keyof T>(entry: T, field: K): T {
  const next = { ...entry }
  delete next[field]
  return next
}

async function reload(workspaceService: WorkspaceService, rootPath: AbsolutePath): Promise<Workspace> {
  workspaceService.invalidate(rootPath)
  const reloaded = await workspaceService.load(rootPath)
  await workspaceService.save(reloaded)
  return reloaded
}

// Idempotently stamp the caller as owner of a fresh workspace.
// If members[] already contains an owner, this is a no-op.
// That happens on a re-register, or when the migration already touched it.
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
