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
