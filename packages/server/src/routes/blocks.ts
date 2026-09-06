import type { SkillRunner, WorkspaceRepository } from '@braidhq/core'
import type { RenderBlock } from '@braidhq/schema'
import { ShowAnswer, ShowDiagram, ShowEvidence, ShowFinding, ShowMatrix, ShowSubgraph, ShowTrace, SkillRunId } from '@braidhq/schema'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { getWorkspaceId } from '../middleware/workspaceId.js'
import { NotFoundResponse, ValidationFailureResponse, WorkspaceIdParam } from './_shared.js'
import { loadWorkspaceById } from './helpers.js'

/**
 * These operations carry no `mcpReadTool` marker on purpose.
 * The per-run gateway serves every operation in the spec, so a skill reaches
 * them anyway, while the long-lived endpoint runs `annotated_only` and so
 * keeps them out of a person's own MCP client, where they mean nothing.
 */

export interface BlocksRouterDeps {
  readonly skillRunner: SkillRunner
  readonly workspaceRepository: WorkspaceRepository
}

const RunIdParam = WorkspaceIdParam.extend({
  runId: SkillRunId.openapi({ param: { name: 'runId', in: 'path' } }),
})

/**
 * Deliberately just an acknowledgement.
 * Every render call is a tool call whose result re-enters the agent's context,
 * so an answer of twenty blocks pays for this body twenty times.
 */
const AcceptedResponse = z.object({ ok: z.literal(true) }).openapi('BlockAccepted')

const ShowAnswerBody = ShowAnswer.omit({ call: true }).openapi('ShowAnswerBody')
const ShowEvidenceBody = ShowEvidence.omit({ call: true }).openapi('ShowEvidenceBody')
const ShowFindingBody = ShowFinding.omit({ call: true }).openapi('ShowFindingBody')
const ShowMatrixBody = ShowMatrix.omit({ call: true }).openapi('ShowMatrixBody')
const ShowTraceBody = ShowTrace.omit({ call: true }).openapi('ShowTraceBody')
const ShowDiagramBody = ShowDiagram.omit({ call: true }).openapi('ShowDiagramBody')
const ShowSubgraphBody = ShowSubgraph.omit({ call: true }).openapi('ShowSubgraphBody')

const renderResponses = {
  200: {
    description: 'The block was recorded on the run.',
    content: { 'application/json': { schema: AcceptedResponse } },
  },
  404: NotFoundResponse,
  400: ValidationFailureResponse,
} as const

const showAnswerRoute = createRoute({
  method: 'post',
  path: '/{runId}/blocks/answer',
  operationId: 'showAnswer',
  summary: 'Render a passage of the answer. Use `@node:<id>` where prose names a graph node.',
  tags: ['render'],
  request: {
    params: RunIdParam,
    body: { content: { 'application/json': { schema: ShowAnswerBody } }, required: true },
  },
  responses: renderResponses,
})

const showEvidenceRoute = createRoute({
  method: 'post',
  path: '/{runId}/blocks/evidence',
  operationId: 'showEvidence',
  summary: 'Render the sources behind a claim, each marked as read from the graph or opened by this run.',
  tags: ['render'],
  request: {
    params: RunIdParam,
    body: { content: { 'application/json': { schema: ShowEvidenceBody } }, required: true },
  },
  responses: renderResponses,
})

const showFindingRoute = createRoute({
  method: 'post',
  path: '/{runId}/blocks/finding',
  operationId: 'showFinding',
  summary: 'Render one consistency statement, with the two or more sides that disagree or agree.',
  tags: ['render'],
  request: {
    params: RunIdParam,
    body: { content: { 'application/json': { schema: ShowFindingBody } }, required: true },
  },
  responses: renderResponses,
})

const showMatrixRoute = createRoute({
  method: 'post',
  path: '/{runId}/blocks/matrix',
  operationId: 'showMatrix',
  summary: 'Render two axes crossing, each cell a state with its own evidence. Both axes are yours to choose.',
  tags: ['render'],
  request: {
    params: RunIdParam,
    body: { content: { 'application/json': { schema: ShowMatrixBody } }, required: true },
  },
  responses: renderResponses,
})

const showTraceRoute = createRoute({
  method: 'post',
  path: '/{runId}/blocks/trace',
  operationId: 'showTrace',
  summary: 'Render what this run searched, read, cited, and deliberately left out.',
  tags: ['render'],
  request: {
    params: RunIdParam,
    body: { content: { 'application/json': { schema: ShowTraceBody } }, required: true },
  },
  responses: renderResponses,
})

const showDiagramRoute = createRoute({
  method: 'post',
  path: '/{runId}/blocks/diagram',
  operationId: 'showDiagram',
  summary: 'Render a mermaid diagram, for a flow or a state machine a table would flatten.',
  tags: ['render'],
  request: {
    params: RunIdParam,
    body: { content: { 'application/json': { schema: ShowDiagramBody } }, required: true },
  },
  responses: renderResponses,
})

const showSubgraphRoute = createRoute({
  method: 'post',
  path: '/{runId}/blocks/subgraph',
  operationId: 'showSubgraph',
  summary: 'Render the slice of the graph this answer stands on, as node ids and the edges between them.',
  tags: ['render'],
  request: {
    params: RunIdParam,
    body: { content: { 'application/json': { schema: ShowSubgraphBody } }, required: true },
  },
  responses: renderResponses,
})

export function createBlocksRouter(deps: BlocksRouterDeps): OpenAPIHono {
  const router = new OpenAPIHono()

  async function record(
    workspaceId: ReturnType<typeof getWorkspaceId>,
    runId: string,
    block: RenderBlock,
  ): Promise<void> {
    await loadWorkspaceById(workspaceId, deps.workspaceRepository)
    await deps.skillRunner.emitBlock(SkillRunId.parse(runId), block)
  }

  router.openapi(showAnswerRoute, async (context) => {
    const { runId } = context.req.valid('param')
    await record(getWorkspaceId(context), runId, { call: 'showAnswer', ...context.req.valid('json') })
    return context.json({ ok: true } as const, 200)
  })

  router.openapi(showEvidenceRoute, async (context) => {
    const { runId } = context.req.valid('param')
    await record(getWorkspaceId(context), runId, { call: 'showEvidence', ...context.req.valid('json') })
    return context.json({ ok: true } as const, 200)
  })

  router.openapi(showFindingRoute, async (context) => {
    const { runId } = context.req.valid('param')
    await record(getWorkspaceId(context), runId, { call: 'showFinding', ...context.req.valid('json') })
    return context.json({ ok: true } as const, 200)
  })

  router.openapi(showMatrixRoute, async (context) => {
    const { runId } = context.req.valid('param')
    await record(getWorkspaceId(context), runId, { call: 'showMatrix', ...context.req.valid('json') })
    return context.json({ ok: true } as const, 200)
  })

  router.openapi(showTraceRoute, async (context) => {
    const { runId } = context.req.valid('param')
    await record(getWorkspaceId(context), runId, { call: 'showTrace', ...context.req.valid('json') })
    return context.json({ ok: true } as const, 200)
  })

  router.openapi(showDiagramRoute, async (context) => {
    const { runId } = context.req.valid('param')
    await record(getWorkspaceId(context), runId, { call: 'showDiagram', ...context.req.valid('json') })
    return context.json({ ok: true } as const, 200)
  })

  router.openapi(showSubgraphRoute, async (context) => {
    const { runId } = context.req.valid('param')
    await record(getWorkspaceId(context), runId, { call: 'showSubgraph', ...context.req.valid('json') })
    return context.json({ ok: true } as const, 200)
  })

  return router
}
