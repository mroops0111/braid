/**
 * Shared OpenAPI building blocks used across workspace-scoped routes.
 *
 * Path parameters declared on parent app.route() mounts are NOT
 * automatically merged into child routes' OpenAPI definitions. Each
 * route under `/workspaces/:workspaceId/*` must therefore re-declare
 * `workspaceId` in its `request.params`. Use `WorkspaceIdParam` to
 * keep the declaration consistent.
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

export const ValidationFailureResponse = {
  description: 'Request body or query failed validation.',
  content: ProblemJsonResponseContent,
} as const
