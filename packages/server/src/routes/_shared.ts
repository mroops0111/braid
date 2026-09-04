/**
 * Shared OpenAPI building blocks used across workspace-scoped routes.
 *
 * Path parameters on parent app.route() mounts do not merge,
 * into a child route's OpenAPI definitions.
 * So each route under `/workspaces/:workspaceId/*` must re-declare it,
 * naming `workspaceId` in its own `request.params`.
 * Use `WorkspaceIdParam` to keep the declaration consistent.
 */
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
 * A wrapper rather than a field,
 * because the extension key needs quoting,
 * and lint then quotes every other key in the object alongside it.
 */
export function mcpReadTool<T extends object>(
  route: T,
  tool: McpToolOverride = {},
): T & { 'x-mcp-integration': { tool: McpToolOverride } } {
  return { ...route, 'x-mcp-integration': { tool } }
}
