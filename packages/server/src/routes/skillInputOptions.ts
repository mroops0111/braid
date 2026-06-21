import type { ClarifyTicketRepository, ModelRepository, PluginRegistry, Workspace, WorkspaceRepository } from '@braidhq/core'
import type { SkillInputDynamicOption } from '@braidhq/schema'
import { SkillInputOptionsResponse, SourceId } from '@braidhq/schema'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { listIntentItems } from '../infrastructure/fs/intentScan.js'
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

async function resolveSourceIntent(
  filter: Record<string, unknown>,
  workspace: Workspace,
): Promise<SkillInputDynamicOption[]> {
  const loaderKindFilter = typeof filter.loaderKind === 'string' ? filter.loaderKind : undefined
  const items = await listIntentItems(workspace)
  return items
    .filter((item) => {
      if (!loaderKindFilter)
        return true
      const source = workspace.sources.find(s => s.id === item.sourceId)
      return source?.kind === 'filesystem' && source.loader?.kind === loaderKindFilter
    })
    .map((item) => {
      // Use safeParse: an invalid sourceId in a hand-edited PRODUCT.md
      // should not 500 the whole dropdown. Drop the field on parse
      // failure so the option still shows up without source tracking.
      const parsed = SourceId.safeParse(item.sourceId)
      return {
        value: item.value,
        label: item.label,
        description: item.sourceName,
        ...(parsed.success ? { sourceId: parsed.data } : {}),
      }
    })
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
