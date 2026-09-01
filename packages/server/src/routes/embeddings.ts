import type { EmbeddingService } from '@braidhq/core'
import { EmbeddingCoverage } from '@braidhq/schema'
import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import { getWorkspaceId } from '../middleware/workspaceId.js'
import { WorkspaceIdParam } from './_shared.js'

export interface EmbeddingsRouterDeps {
  /** Absent when the deployment configures no embedding backend. */
  embeddingService?: EmbeddingService
}

const CoverageResponse = EmbeddingCoverage.openapi('EmbeddingCoverage')

const getCoverageRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'getEmbeddingCoverage',
  summary: 'How much of the graph currently has a usable vector.',
  description: 'A restored workspace answers structurally from the first moment and gains semantic search as its index fills, so a viewer needs to know how far along that is. `modelId` is null when no embedding backend is configured, in which case every count is zero.',
  tags: ['embeddings'],
  request: { params: WorkspaceIdParam },
  responses: {
    200: {
      description: 'Current coverage.',
      content: { 'application/json': { schema: CoverageResponse } },
    },
  },
})

const rebuildRoute = createRoute({
  method: 'post',
  path: '/rebuild',
  operationId: 'rebuildEmbeddings',
  summary: 'Bring every node vector up to date.',
  description: 'Runs in the background and answers immediately, since a whole graph takes minutes. Progress arrives as `embedding.progress` on the workspace event stream. Nodes whose text has not moved are skipped, so a repeat call costs almost nothing.',
  tags: ['embeddings'],
  request: { params: WorkspaceIdParam },
  responses: {
    202: {
      description: 'Rebuild accepted. Coverage as it stood when the call was made.',
      content: { 'application/json': { schema: CoverageResponse } },
    },
  },
})

const EMPTY_COVERAGE: EmbeddingCoverage = { total: 0, current: 0, stale: 0, modelId: null }

export function createEmbeddingsRouter(deps: EmbeddingsRouterDeps): OpenAPIHono {
  const router = new OpenAPIHono()

  router.openapi(getCoverageRoute, async (context) => {
    if (!deps.embeddingService)
      return context.json(EMPTY_COVERAGE, 200)
    return context.json(await deps.embeddingService.coverage(getWorkspaceId(context)), 200)
  })

  router.openapi(rebuildRoute, async (context) => {
    const workspaceId = getWorkspaceId(context)
    if (!deps.embeddingService)
      return context.json(EMPTY_COVERAGE, 202)
    const service = deps.embeddingService
    const before = await service.coverage(workspaceId)
    // Answering first keeps the caller from holding a connection open for minutes.
    // The service publishes progress and failure on the event stream,
    // so nothing is lost by not awaiting it here.
    void service.rebuild(workspaceId).catch(() => {})
    return context.json(before, 202)
  })

  return router
}
