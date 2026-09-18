/**
 * Shared OpenAPI building blocks used across workspace-scoped routes.
 *
 * Path parameters on parent app.route() mounts do not merge,
 * into a child route's OpenAPI definitions.
 * So each route under `/workspaces/:workspaceId/*` must re-declare it,
 * naming `workspaceId` in its own `request.params`.
 * Use `WorkspaceIdParam` to keep the declaration consistent.
 */
import type { OutputForm, SkillCategory } from '@braidhq/schema'
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

export const ConflictResponse = {
  description: 'The deployment is not configured for this action.',
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
 * Braid's own bookkeeping rather than something the gateway reads,
 * so it travels under its own key and is stripped before the spec goes out.
 */
export const RUN_CATEGORIES_KEY = 'x-braid-run-categories'

/**
 * Which output forms an operation is offered to, on the same mechanism.
 *
 * A second axis rather than more values on the first,
 * because it varies within a kind of run rather than across kinds.
 * One skill renders blocks for a reader who asked to watch the answer assemble,
 * and writes for the next reader who did not, or for the batch that has none,
 * and only the render operations differ between those runs.
 *
 * Unmarked is visible to both, which is right for everything
 * that is not a way of drawing on a surface.
 */
export const RUN_OUTPUT_FORMS_KEY = 'x-braid-run-output-forms'

/**
 * Narrow an operation to the runs that have any business calling it.
 *
 * `categories` is the kind of run, and `forms` the shape of its output,
 * left off wherever the operation has nothing to do with how a run is drawn.
 *
 * A run's tools come from the spec its gateway is given,
 * so this is where the question belongs.
 * Not in a prompt, which holds about half the time,
 * and not in the handler, which would have to learn who is calling.
 * An operation left unmarked is visible to every run,
 * which is right for a read.
 *
 * The list is what may see it, so `[]` means no run may.
 * That is the honest reading for a decision a person makes,
 * such as applying a proposal.
 *
 * This scopes what a run is offered, not what the API will accept.
 * A run still carries a credential the REST surface honours,
 * so making this a boundary rather than a curation is a change to the token.
 */
export function forRuns<T extends object>(
  route: T,
  categories: readonly SkillCategory[],
  forms?: readonly OutputForm[],
): T & Record<typeof RUN_CATEGORIES_KEY, readonly SkillCategory[]> {
  return {
    ...route,
    [RUN_CATEGORIES_KEY]: categories,
    ...(forms ? { [RUN_OUTPUT_FORMS_KEY]: forms } : {}),
  } as T & Record<typeof RUN_CATEGORIES_KEY, readonly SkillCategory[]>
}
