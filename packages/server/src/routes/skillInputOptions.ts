import type { ClarifyTicketRepository, ModelRepository, PluginRegistry, Workspace, WorkspaceRepository } from '@braidhq/core'
import type { SkillInputDynamicOption } from '@braidhq/schema'
import { readdir } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { SkillInputOptionsResponse } from '@braidhq/schema'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { getWorkspaceId } from '../middleware/workspaceId.js'
import { WorkspaceIdParam } from './_shared.js'
import { loadWorkspaceById } from './helpers.js'

/**
 * Studio-facing endpoint that resolves a skill input provider type
 * (declared in a SKILL.md frontmatter) to the current option list for
 * a given workspace. Used by the typed Actions form to populate
 * pickers backed by `graph-node` / `source-intent` / `clarify` /
 * `proposal` rather than static options.
 *
 * The endpoint is intentionally read-only and lives alongside other
 * Studio-metadata routes; it's mounted under
 * `/workspaces/:workspaceId/skill-input-options`.
 */

const ProviderType = z.enum(['graph-node', 'source-intent', 'clarify', 'proposal'])

const QuerySchema = z.object({
  type: ProviderType.openapi({ param: { name: 'type', in: 'query' } }),
  /**
   * JSON-encoded filter object. Shape depends on the provider:
   * graph-node    -> { types?: string[]; statuses?: string[]; renderHint?: { container?: boolean } }
   * source-intent -> { loaderKind?: string }
   * clarify       -> { status?: 'pending' | 'answered' | 'applied' | 'skipped' }
   * proposal      -> { status?: 'pending' | 'applied' | 'rejected' }
   *
   * Query-string-encoded JSON keeps the schema simple while letting
   * each provider have a different filter shape. Studio is the only
   * intended caller; humans drafting URLs by hand will rarely need it.
   */
  filter: z.string().optional().openapi({ param: { name: 'filter', in: 'query' } }),
})

const route = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listSkillInputOptions',
  summary: 'Resolve a skill input provider to its current option list (Studio form helper).',
  tags: ['skills'],
  request: {
    params: WorkspaceIdParam,
    query: QuerySchema,
  },
  responses: {
    200: {
      description: 'Option list (possibly empty when the workspace has nothing matching the filter).',
      content: { 'application/json': { schema: SkillInputOptionsResponse } },
    },
  },
})

export interface SkillInputOptionsRouterDeps {
  readonly modelRepository: ModelRepository
  readonly clarifyRepository: ClarifyTicketRepository
  readonly workspaceRepository: WorkspaceRepository
  readonly pluginRegistry: PluginRegistry
}

export function createSkillInputOptionsRouter(deps: SkillInputOptionsRouterDeps): OpenAPIHono {
  const router = new OpenAPIHono()

  router.openapi(route, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const workspace = await loadWorkspaceById(workspaceId, deps.workspaceRepository)
    const { type, filter } = context.req.valid('query')
    const parsedFilter: Record<string, unknown> = filter
      ? safeParseJson(filter)
      : {}

    const items = await resolveProvider(type, parsedFilter, workspace, deps)
    return context.json({ items }, 200)
  })

  return router
}

async function resolveProvider(
  type: z.infer<typeof ProviderType>,
  filter: Record<string, unknown>,
  workspace: Workspace,
  deps: SkillInputOptionsRouterDeps,
): Promise<SkillInputDynamicOption[]> {
  switch (type) {
    case 'graph-node':
      return resolveGraphNode(filter, workspace, deps)
    case 'source-intent':
      return resolveSourceIntent(filter, workspace)
    case 'clarify':
      return resolveClarify(filter, workspace.id, deps.clarifyRepository)
    case 'proposal':
      // Phase 2 leaves the proposal provider as a stub; no SKILL.md
      // wires it yet. Returning empty keeps the endpoint contract
      // stable while signalling "implement when a skill actually
      // declares it".
      return []
  }
}

async function resolveGraphNode(
  filter: Record<string, unknown>,
  workspace: Workspace,
  deps: SkillInputOptionsRouterDeps,
): Promise<SkillInputDynamicOption[]> {
  const types = Array.isArray(filter.types) ? (filter.types as string[]) : undefined
  const statuses = Array.isArray(filter.statuses) ? (filter.statuses as string[]) : undefined
  const renderHint = isRecord(filter.renderHint) ? filter.renderHint : undefined
  const wantContainerOnly = renderHint?.container === true

  let typesToInclude = types
  if (wantContainerOnly) {
    // Container-ness is an ontology concern: the ontology's node-type
    // descriptors carry `renderHint.container`. Intersect with any
    // explicit `types` filter so both axes compose.
    const ontology = deps.pluginRegistry.requireOntology(workspace.productManifest.ontologyId)
    const containerTypeIds = ontology.nodeTypes
      .filter(descriptor => descriptor.renderHint?.container === true)
      .map(descriptor => descriptor.id)
    typesToInclude = typesToInclude
      ? typesToInclude.filter(t => containerTypeIds.includes(t as never))
      : containerTypeIds
  }

  const snapshot = await deps.modelRepository.load(workspace.id)
  const matched = snapshot.nodes.filter((node) => {
    if (typesToInclude && !typesToInclude.includes(node.type))
      return false
    if (statuses && !statuses.includes(node.status))
      return false
    return true
  })
  return matched.map(node => ({
    value: node.id,
    label: node.name,
    ...(node.description ? { description: firstLine(node.description) } : {}),
  }))
}

/**
 * Document-like file extensions we treat as "an intent". Binary assets
 * (images, fonts) and lockfile-style siblings are excluded.
 */
const INTENT_FILE_EXTENSIONS = new Set(['.md', '.mdx', '.markdown', '.txt', '.rst'])

async function resolveSourceIntent(
  filter: Record<string, unknown>,
  workspace: Workspace,
): Promise<SkillInputDynamicOption[]> {
  const loaderKindFilter = typeof filter.loaderKind === 'string' ? filter.loaderKind : undefined
  const items: SkillInputDynamicOption[] = []
  for (const source of workspace.sources) {
    if (source.role !== 'intent')
      continue
    if (source.kind !== 'filesystem')
      // MCP intent sources aren't directory-listable; future enhancement.
      continue
    if (loaderKindFilter && source.loader?.kind !== loaderKindFilter)
      continue
    // Resolve `source.path` against `workspace.rootPath` since the
    // manifest typically stores it relative (e.g. "./intents/prd").
    const absoluteRoot = isAbsolute(source.path) ? source.path : join(workspace.rootPath, source.path)
    items.push(...await listIntentEntries(absoluteRoot, source.name))
  }
  return items
}

/**
 * Each top-level entry under an intent source counts as one "intent":
 *
 *   intents/prd/
 *     feature-a/          ← entry: a folder of docs / assets
 *       index.md
 *       assets/foo.png
 *     standalone.md       ← entry: a flat markdown doc
 *     .DS_Store           ← skipped (hidden)
 *
 * Folders are included only when they contain at least one document-
 * like file (recursive); a folder of just images / lockfiles would not
 * be a useful pick. Loose top-level files are included only when their
 * extension is in `INTENT_FILE_EXTENSIONS`.
 */
async function listIntentEntries(root: string, sourceName: string): Promise<SkillInputDynamicOption[]> {
  const items: SkillInputDynamicOption[] = []
  let topEntries
  try {
    topEntries = await readdir(root, { withFileTypes: true })
  }
  catch {
    return items
  }
  for (const entry of topEntries) {
    if (entry.name.startsWith('.'))
      continue
    if (entry.isDirectory()) {
      const folder = join(root, entry.name)
      if (await containsDocument(folder, 4)) {
        items.push({
          value: `${entry.name}/`,
          label: entry.name,
          description: sourceName,
        })
      }
      continue
    }
    if (entry.isFile() && isIntentDocument(entry.name)) {
      items.push({
        value: entry.name,
        label: stripExtension(entry.name),
        description: sourceName,
      })
    }
  }
  // Stable order so the form doesn't reshuffle on every fetch.
  return items.sort((a, b) => a.label.localeCompare(b.label))
}

async function containsDocument(dir: string, maxDepth: number): Promise<boolean> {
  if (maxDepth < 0)
    return false
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  }
  catch {
    return false
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.'))
      continue
    if (entry.isFile() && isIntentDocument(entry.name))
      return true
    if (entry.isDirectory()) {
      if (await containsDocument(join(dir, entry.name), maxDepth - 1))
        return true
    }
  }
  return false
}

function isIntentDocument(filename: string): boolean {
  const dot = filename.lastIndexOf('.')
  if (dot < 0)
    return false
  return INTENT_FILE_EXTENSIONS.has(filename.slice(dot).toLowerCase())
}

function stripExtension(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot < 0 ? filename : filename.slice(0, dot)
}

async function resolveClarify(
  filter: Record<string, unknown>,
  workspaceId: Workspace['id'],
  clarifyRepository: ClarifyTicketRepository,
): Promise<SkillInputDynamicOption[]> {
  const status = typeof filter.status === 'string' ? filter.status : undefined
  const tickets = await clarifyRepository.list({
    workspaceId,
    ...(status ? { statuses: [status] as never } : {}),
  })
  return tickets.map(ticket => ({
    value: ticket.id,
    label: truncate(ticket.question, 80),
    description: ticket.status,
  }))
}

function safeParseJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value)
    return isRecord(parsed) ? parsed : {}
  }
  catch {
    return {}
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function firstLine(text: string): string {
  const trimmed = text.trim()
  const nl = trimmed.indexOf('\n')
  return nl === -1 ? truncate(trimmed, 120) : truncate(trimmed.slice(0, nl), 120)
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}
