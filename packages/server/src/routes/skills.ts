import type {
  SkillRegistry,
  SkillRunner,
  WorkspaceRepository,
} from '@braidhq/core'
import type { SkillId } from '@braidhq/schema'
import { SkillId as SkillIdSchema, SkillManifest, SkillRunId } from '@braidhq/schema'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { getWorkspaceId } from '../middleware/workspaceId.js'
import { NotFoundResponse, WorkspaceIdParam } from './_shared.js'
import { loadWorkspaceById } from './helpers.js'

const RunBody = z.object({
  args: z.string().default(''),
  /** Continue an existing claude conversation (from a prior session-started event). */
  resumeSessionId: z.string().min(1).optional(),
}).openapi('SkillRunBody')

const SkillIdParam = WorkspaceIdParam.extend({
  skillId: SkillIdSchema.openapi({ param: { name: 'skillId', in: 'path' } }),
})

const SkillListResponse = z.object({
  items: z.array(SkillManifest),
}).openapi('SkillListResponse')

const RunCreatedResponse = z.object({
  runId: SkillRunId,
}).openapi('RunCreatedResponse')

export interface SkillsRouterDeps {
  readonly skillRegistry: SkillRegistry
  readonly skillRunner: SkillRunner
  readonly workspaceRepository: WorkspaceRepository
}

const listSkillsRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listSkills',
  summary: 'List skills available in a workspace (builtin + plugin + workspace + extension overlays).',
  tags: ['skills'],
  request: { params: WorkspaceIdParam },
  responses: {
    200: {
      description: 'The skill list.',
      content: { 'application/json': { schema: SkillListResponse } },
    },
  },
})

const getSkillRoute = createRoute({
  method: 'get',
  path: '/{skillId}',
  operationId: 'getSkill',
  summary: 'Fetch a single skill manifest by id.',
  tags: ['skills'],
  request: { params: SkillIdParam },
  responses: {
    200: {
      description: 'The skill manifest.',
      content: { 'application/json': { schema: SkillManifest } },
    },
    404: NotFoundResponse,
  },
})

const runSkillRoute = createRoute({
  method: 'post',
  path: '/{skillId}/run',
  operationId: 'runSkill',
  summary: 'Fire-and-forget run of a skill. Returns the runId to subscribe to via SSE.',
  description: 'The subprocess + event drain runs in the background; events are persisted to JSONL and broadcast to subscribers regardless of whether the client stays connected. Tail progress via GET /workspaces/{workspaceId}/runs/{runId}/events.',
  tags: ['skills'],
  request: {
    params: SkillIdParam,
    body: { content: { 'application/json': { schema: RunBody } } },
  },
  responses: {
    202: {
      description: 'The accepted run id.',
      content: { 'application/json': { schema: RunCreatedResponse } },
    },
    404: NotFoundResponse,
  },
})

export function createSkillsRouter(deps: SkillsRouterDeps): OpenAPIHono {
  const router = new OpenAPIHono()

  router.openapi(listSkillsRoute, async (context) => {
    const workspace = await loadWorkspaceById(getWorkspaceId(context), deps.workspaceRepository)
    const manifests = await deps.skillRegistry.list(workspace)
    return context.json({
      items: manifests.map(manifest => manifest.toData()),
    }, 200)
  })

  router.openapi(getSkillRoute, async (context) => {
    const workspace = await loadWorkspaceById(getWorkspaceId(context), deps.workspaceRepository)
    const { skillId } = context.req.valid('param')
    const manifest = await deps.skillRegistry.get(workspace, skillId)
    return context.json(manifest.toData(), 200)
  })

  router.openapi(runSkillRoute, async (context) => {
    const workspace = await loadWorkspaceById(getWorkspaceId(context), deps.workspaceRepository)
    const { skillId } = context.req.valid('param')
    const { args, resumeSessionId } = context.req.valid('json')
    const options = resumeSessionId ? { resumeSessionId } : undefined
    const runId = await deps.skillRunner.start(workspace, skillId as SkillId, args, options)
    return context.json({ runId }, 202)
  })

  return router
}
