/**
 * Shared OpenAPI building blocks used across workspace-scoped routes.
 *
 * Path parameters on parent app.route() mounts do not merge,
 * into a child route's OpenAPI definitions.
 * So each route under `/workspaces/:workspaceId/*` must re-declare it,
 * naming `workspaceId` in its own `request.params`.
 * Use `WorkspaceIdParam` to keep the declaration consistent.
 */
import type { SkillCategory } from '@braidhq/schema'
import { BraidProblemJson, WorkspaceId } from '@braidhq/schema'
import { z } from '@hono/zod-openapi'

export const WorkspaceIdParam = z.object({
  workspaceId: WorkspaceId.openapi({
    param: { name: 'workspaceId', in: 'path' },
    example: 'my-workspace',
  }),
})

export const ProblemJsonResponseContent = {
  'application/problem+json': { schema: BraidProblemJson },
}

export const NotFoundResponse = {
  description: 'The requested entity does not exist.',
  content: ProblemJsonResponseContent,
} as const

export const ForbiddenResponse = {
  description: 'The caller lacks permission for this action.',
  content: ProblemJsonResponseContent,
} as const

export const ValidationFailureResponse = {
  description: 'Request body or query failed validation.',
  content: ProblemJsonResponseContent,
} as const

/** What a marked operation may say about the tool it becomes. */
interface McpToolOverride {
  /** Shown to the model instead of the operation's `summary`. */
  readonly description?: string
  /** JSONata that trims the response down to what a model should see. */
  readonly response?: string
}

/**
 * Opts an operation into the MCP tool surface `openapi-mcp-gateway` serves.
 *
 * The gateway runs with `annotated_only`,
 * so an operation this does not wrap is invisible to an MCP client.
 * That makes the wrapping the curation list,
 * kept beside the route it describes rather than in a separate allowlist.
 *
 * Only reads are wrapped.
 * A tool that cannot change the graph needs far less trust than one that can,
 * and a write here would spend a seat on a caller who only asked to read.
 *
 * A wrapper rather than a field, because the extension key needs quoting,
 * and lint then quotes every other key in the object alongside it.
 */
export function mcpReadTool<T extends object>(
  route: T,
  tool: McpToolOverride = {},
): T & { 'x-mcp-integration': { tool: McpToolOverride } } {
  return { ...route, 'x-mcp-integration': { tool } }
}

/**
 * The extension key naming which runs may see an operation at all.
 *
 * Braid's own bookkeeping rather than something the gateway reads, so it
 * travels under its own key and is stripped before the spec goes out.
 */
export const RUN_CATEGORIES_KEY = 'x-braid-run-categories'

/**
 * Narrow an operation to the kinds of run that have any business calling it.
 *
 * A run's tools come from the spec its gateway is given, so this is where the
 * question belongs: not in a prompt, which holds about half the time, and not
 * in the handler, which would have to learn who is calling to answer it. An
 * operation left unmarked is visible to every run, which is right for a read.
 *
 * The list is what may see it, so `[]` means no run may. That is the honest
 * reading for a decision a person makes, such as applying a proposal.
 *
 * This scopes what a run is offered, not what the API will accept. A run
 * still carries a credential the REST surface honours, so making this a
 * boundary rather than a curation is a separate change to the token.
 */
export function forRuns<T extends object>(
  route: T,
  categories: readonly SkillCategory[],
): T & Record<typeof RUN_CATEGORIES_KEY, readonly SkillCategory[]> {
  return { ...route, [RUN_CATEGORIES_KEY]: categories } as T & Record<typeof RUN_CATEGORIES_KEY, readonly SkillCategory[]>
}
