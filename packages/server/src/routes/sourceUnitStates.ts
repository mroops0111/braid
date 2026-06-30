import type { IntentLister, SourceUnitDigest, SourceUnitStateService, WorkspaceService } from '@braidhq/core'
import { computeSourceDiff } from '@braidhq/core'
import { SourceId, SourceUnitDiff, SourceUnitState } from '@braidhq/schema'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { getWorkspaceId } from '../middleware/workspaceId.js'
import { NotFoundResponse, ValidationFailureResponse, WorkspaceIdParam } from './_shared.js'

const ListQuery = z.object({
  sourceId: SourceId.optional().openapi({ description: 'Restrict to one source.' }),
})

const ListResponse = z.object({
  items: z.array(SourceUnitState),
}).openapi('SourceUnitStateListResponse')

const SourceIdParam = WorkspaceIdParam.extend({
  sourceId: SourceId.openapi({ param: { name: 'sourceId', in: 'path' } }),
})

const DiffResponse = SourceUnitDiff.openapi('SourceUnitDiffResponse')

export interface SourceUnitStatesRouterDeps {
  sourceUnitStateService: SourceUnitStateService
  /**
   * Optional `(workspaceService, intentLister, digest)` triple. When all
   * three are present, the router exposes the `:sourceId/diff` route.
   * When any is missing, the route is simply not registered — callers
   * see a 404 from Hono's router, matching the "this server does not
   * support that operation" semantics other partially-wired surfaces
   * follow (Batch / Skills).
   */
  diffSupport?: {
    workspaceService: WorkspaceService
    intentLister: IntentLister
    digest: SourceUnitDigest
  }
}

const listRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listSourceUnitStates',
  summary: 'List recorded observations per source unit for a workspace.',
  description: 'Returns the framework\'s current view of each source unit '
    + 'last seen by an extract run. One entry per (sourceId, path). Used '
    + 'by Studio to display per-unit freshness and by Reactor to compute '
    + 'what needs re-extraction.',
  tags: ['source-unit-states'],
  request: {
    params: WorkspaceIdParam,
    query: ListQuery,
  },
  responses: {
    200: {
      description: 'The recorded observations.',
      content: { 'application/json': { schema: ListResponse } },
    },
    400: ValidationFailureResponse,
  },
})

const diffRoute = createRoute({
  method: 'get',
  path: '/{sourceId}/diff',
  operationId: 'getSourceUnitDiff',
  summary: 'Diff a source\'s current units on disk against the recorded ledger.',
  description: 'Returns the partition (`new`, `changed`, `unchanged`, `orphaned`) the Reactor uses internally to decide what to re-extract. Studio\'s Actions form consumes the same shape to render per-option badges on the source-intent picker.',
  tags: ['source-unit-states'],
  request: { params: SourceIdParam },
  responses: {
    200: {
      description: 'The diff partition.',
      content: { 'application/json': { schema: DiffResponse } },
    },
    404: NotFoundResponse,
  },
})

export function createSourceUnitStatesRouter(deps: SourceUnitStatesRouterDeps): OpenAPIHono {
  const router = new OpenAPIHono()

  router.openapi(listRoute, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const { sourceId } = context.req.valid('query')
    const items = sourceId
      ? await deps.sourceUnitStateService.listBySource(workspaceId, sourceId)
      : await deps.sourceUnitStateService.listByWorkspace(workspaceId)
    return context.json({ items: [...items] }, 200)
  })

  if (deps.diffSupport) {
    const { workspaceService, intentLister, digest } = deps.diffSupport
    router.openapi(diffRoute, async (context) => {
      const workspaceId = getWorkspaceId(context)
      const { sourceId } = context.req.valid('param')
      const workspace = await workspaceService.findById(workspaceId)
      const diff = await computeSourceDiff(
        {
          intentLister,
          digest,
          sourceUnitStateService: deps.sourceUnitStateService,
        },
        workspace,
        sourceId,
      )
      return context.json(diff, 200)
    })
  }

  return router
}
