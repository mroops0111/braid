import type { ClarificationRepository, ModelRepository, PluginRegistry, Workspace, WorkspaceRepository } from '@braidhq/core'
import type { SkillInputDynamicOption } from '@braidhq/schema'
import { SkillInputOptionsResponse, SourceId, SourceRole } from '@braidhq/schema'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { listUnitItems, unitBearingRolesOf } from '../infrastructure/source/unitScan.js'
import { getWorkspaceId } from '../middleware/workspaceId.js'
import { WorkspaceIdParam } from './_shared.js'
import { loadWorkspaceById } from './helpers.js'

/**
 * Studio-facing endpoint that resolves a skill input provider kind,
 * declared in a SKILL.md frontmatter, to the current option list,
 * for a given workspace.
 * The typed Actions form uses it to populate pickers,
 * backed by `graph-node`, `source`, or `clarify` (not static).
 * Read-only, and lives alongside other Studio-metadata routes.
 * Mounted under `/workspaces/:workspaceId/skill-input-options`.
 */

const ProviderKind = z.enum(['graph-node', 'source', 'clarify'])

const QuerySchema = z.object({
  kind: ProviderKind.openapi({ param: { name: 'kind', in: 'query' } }),
  // JSON-encoded filter object whose shape depends on the provider.
  // graph-node uses `{ types?, statuses?, renderHint?: { container? } }`,
  // source uses `{ role?, loaderKind? }`,
  // and clarify uses `{ status?: pending | answered | applied | skipped }`.
  //
  // Query-string-encoded JSON keeps the schema simple,
  // while letting each provider carry a different filter shape.
  // Studio is the only intended caller.
  // Humans drafting URLs by hand will rarely need it.
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
  readonly clarificationRepository: ClarificationRepository
  readonly workspaceRepository: WorkspaceRepository
  readonly pluginRegistry: PluginRegistry
}

export function createSkillInputOptionsRouter(deps: SkillInputOptionsRouterDeps): OpenAPIHono {
  const router = new OpenAPIHono()

  router.openapi(route, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const workspace = await loadWorkspaceById(workspaceId, deps.workspaceRepository)
    const { kind, filter } = context.req.valid('query')
    const parsedFilter: Record<string, unknown> = filter
      ? safeParseJson(filter)
      : {}

    const items = await resolveProvider(kind, parsedFilter, workspace, deps)
    return context.json({ items }, 200)
  })

  return router
}

async function resolveProvider(
  kind: z.infer<typeof ProviderKind>,
  filter: Record<string, unknown>,
  workspace: Workspace,
  deps: SkillInputOptionsRouterDeps,
): Promise<SkillInputDynamicOption[]> {
  switch (kind) {
    case 'graph-node':
      return resolveGraphNode(filter, workspace, deps)
    case 'source':
      return resolveSource(filter, workspace, deps)
    case 'clarify':
      return resolveClarification(filter, workspace.id, deps.clarificationRepository)
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
    // Container-ness is an ontology concern.
    // Its node-type descriptors carry `renderHint.container`.
    // Intersect with any explicit `types` filter so both axes compose.
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

async function resolveSource(
  filter: Record<string, unknown>,
  workspace: Workspace,
  deps: SkillInputOptionsRouterDeps,
): Promise<SkillInputDynamicOption[]> {
  const loaderKindFilter = typeof filter.loaderKind === 'string' ? filter.loaderKind : undefined
  const roleFilter = typeof filter.role === 'string' ? SourceRole.parse(filter.role) : undefined
  const roles = roleFilter ? [roleFilter] : unitBearingRolesOf(deps.pluginRegistry, workspace)
  const items = await listUnitItems(workspace, roles)
  return items
    .filter((item) => {
      if (!loaderKindFilter)
        return true
      const source = workspace.sources.find(s => s.id === item.sourceId)
      return source?.kind === 'filesystem' && source.loader?.kind === loaderKindFilter
    })
    .map((item) => {
      // Use safeParse here.
      // A hand-edited PRODUCT.md may carry an invalid sourceId,
      // which should not 500 the whole dropdown.
      // Drop the field on parse failure so the option still shows up.
      const parsed = SourceId.safeParse(item.sourceId)
      return {
        value: item.value,
        label: item.label,
        description: item.sourceName,
        ...(parsed.success ? { sourceId: parsed.data } : {}),
      }
    })
}

async function resolveClarification(
  filter: Record<string, unknown>,
  workspaceId: Workspace['id'],
  clarificationRepository: ClarificationRepository,
): Promise<SkillInputDynamicOption[]> {
  const status = typeof filter.status === 'string' ? filter.status : undefined
  const clarifications = await clarificationRepository.list({
    workspaceId,
    ...(status ? { statuses: [status] as never } : {}),
  })
  return clarifications.map(clarification => ({
    value: clarification.id,
    label: truncate(clarification.question, 80),
    description: clarification.status,
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
