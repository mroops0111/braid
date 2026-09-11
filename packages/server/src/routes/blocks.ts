import type { ModelRepository, SkillRunner, WorkspaceRepository } from '@braidhq/core'
import type { EmittedBlock, RenderBlock, WorkspaceId } from '@braidhq/schema'
import { evidenceSupport, graphCitations, NotFoundError, ValidationError } from '@braidhq/core'
import { BlockId, EvidenceSupport, ShowAnswer, ShowDiagram, ShowEvidence, ShowFinding, ShowMatrix, ShowSubgraph, ShowTrace, SkillRunId } from '@braidhq/schema'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { getWorkspaceId } from '../middleware/workspaceId.js'
import { NotFoundResponse, ValidationFailureResponse, WorkspaceIdParam } from './_shared.js'
import { loadWorkspaceById } from './helpers.js'

/**
 * These operations carry no `mcpReadTool` marker on purpose.
 * The per-run gateway serves every operation in the spec,
 * so a skill reaches them anyway,
 * while the long-lived endpoint runs `annotated_only`,
 * and so keeps them out of a person's own MCP client where they mean nothing.
 */

export interface BlocksRouterDeps {
  readonly skillRunner: SkillRunner
  readonly workspaceRepository: WorkspaceRepository
  /** Asked what the graph holds, so a citation to it can be checked. */
  readonly modelRepository: ModelRepository
}

const RunIdParam = WorkspaceIdParam.extend({
  runId: SkillRunId.openapi({ param: { name: 'runId', in: 'path' } }),
})

/**
 * What the call produced, and nothing the caller already knows.
 *
 * The status line says it succeeded,
 * so a body repeating that carries no information while still costing tokens.
 * Every render call is a tool call whose result re-enters the agent's context,
 * and an answer runs to twenty of them.
 * What the caller cannot know is what the server decided,
 * so that is what comes back.
 */
const RecordedResponse = z.object({
  blockId: BlockId,
  /**
   * How well the sides of a finding are sourced,
   * derived here from their references,
   * because a skill asserting its own confidence would be marking its own work.
   * Only `showFinding` produces one.
   */
  support: EvidenceSupport.optional(),
}).openapi('BlockRecorded')

const ShowAnswerBody = ShowAnswer.omit({ call: true }).openapi('ShowAnswerBody')
const ShowEvidenceBody = ShowEvidence.omit({ call: true }).openapi('ShowEvidenceBody')
// `support` is derived from the sides on arrival, so the skill never sends it.
const ShowFindingBody = ShowFinding.omit({ call: true, support: true }).openapi('ShowFindingBody')
const ShowMatrixBody = ShowMatrix.omit({ call: true }).openapi('ShowMatrixBody')
const ShowTraceBody = ShowTrace.omit({ call: true }).openapi('ShowTraceBody')
const ShowDiagramBody = ShowDiagram.omit({ call: true }).openapi('ShowDiagramBody')
const ShowSubgraphBody = ShowSubgraph.omit({ call: true }).openapi('ShowSubgraphBody')

const renderResponses = {
  201: {
    description: 'The block was recorded on the run.',
    content: { 'application/json': { schema: RecordedResponse } },
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

  /**
   * A ref saying it came from the graph is a claim the graph can settle,
   * and a citation to a node nobody holds is worse than none,
   * because it reads as corroboration.
   * Refused here so the run is told while it can still fix it,
   * rather than a reader finding it later.
   *
   * Only the ids a block names are resolved, never the whole model.
   * Every render call would otherwise load the graph,
   * and an answer is a dozen calls.
   */
  async function checkCitations(
    workspaceId: WorkspaceId,
    block: RenderBlock,
  ): Promise<void> {
    const unsettled: string[] = []
    for (const citation of graphCitations(block)) {
      if (citation.nodeId === undefined) {
        unsettled.push(citation.describedAs)
        continue
      }
      try {
        await deps.modelRepository.getNode(workspaceId, citation.nodeId)
      }
      catch (error) {
        if (!(error instanceof NotFoundError))
          throw error
        unsettled.push(citation.describedAs)
      }
    }
    if (unsettled.length === 0)
      return
    throw new ValidationError(
      `This block cites the graph for ${unsettled.join(', ')}, which the model does not hold. `
      + 'Set `nodeId` to the node the reference was copied from, '
      + 'or set `provenance` to `agent` to mark it as your own reading.',
    )
  }

  async function record(
    workspaceId: ReturnType<typeof getWorkspaceId>,
    runId: string,
    block: RenderBlock,
  ): Promise<EmittedBlock['id']> {
    const workspace = await loadWorkspaceById(workspaceId, deps.workspaceRepository)
    await checkCitations(workspace.id, block)
    const { id } = await deps.skillRunner.emitBlock(SkillRunId.parse(runId), block)
    return id
  }

  router.openapi(showAnswerRoute, async (context) => {
    const { runId } = context.req.valid('param')
    const blockId = await record(getWorkspaceId(context), runId, { call: 'showAnswer', ...context.req.valid('json') })
    return context.json({ blockId }, 201)
  })

  router.openapi(showEvidenceRoute, async (context) => {
    const { runId } = context.req.valid('param')
    const blockId = await record(getWorkspaceId(context), runId, { call: 'showEvidence', ...context.req.valid('json') })
    return context.json({ blockId }, 201)
  })

  router.openapi(showFindingRoute, async (context) => {
    const { runId } = context.req.valid('param')
    const finding = context.req.valid('json')
    const support = evidenceSupport(finding.sides)
    const blockId = await record(getWorkspaceId(context), runId, { call: 'showFinding', ...finding, support })
    return context.json({ blockId, support }, 201)
  })

  router.openapi(showMatrixRoute, async (context) => {
    const { runId } = context.req.valid('param')
    const blockId = await record(getWorkspaceId(context), runId, { call: 'showMatrix', ...context.req.valid('json') })
    return context.json({ blockId }, 201)
  })

  router.openapi(showTraceRoute, async (context) => {
    const { runId } = context.req.valid('param')
    const blockId = await record(getWorkspaceId(context), runId, { call: 'showTrace', ...context.req.valid('json') })
    return context.json({ blockId }, 201)
  })

  router.openapi(showDiagramRoute, async (context) => {
    const { runId } = context.req.valid('param')
    const blockId = await record(getWorkspaceId(context), runId, { call: 'showDiagram', ...context.req.valid('json') })
    return context.json({ blockId }, 201)
  })

  router.openapi(showSubgraphRoute, async (context) => {
    const { runId } = context.req.valid('param')
    const blockId = await record(getWorkspaceId(context), runId, { call: 'showSubgraph', ...context.req.valid('json') })
    return context.json({ blockId }, 201)
  })

  return router
}
