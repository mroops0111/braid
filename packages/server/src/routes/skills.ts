import type {
  SkillRegistry,
  SkillRunner,
  SourceUnitStateService,
  WorkspaceRepository,
} from '@braidhq/core'
import type { SkillEvent, SkillRunId as SkillRunIdType, Workspace } from '@braidhq/schema'
import { createLogger } from '@braidhq/core'
import { SkillId as SkillIdSchema, SkillManifest, SkillRunId, SourceId } from '@braidhq/schema'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { extractBearerToken } from '../middleware/auth.js'
import { requirePermission } from '../middleware/workspaceAccess.js'
import { getWorkspaceId } from '../middleware/workspaceId.js'
import { NotFoundResponse, WorkspaceIdParam } from './_shared.js'
import { loadWorkspaceById } from './helpers.js'

const BRAID_EXTRACT_SKILL_ID = 'braid-extract'

const SourceUnitRef = z.object({
  sourceId: SourceId,
  path: z.string().min(1),
}).openapi('SourceUnitRef')

const RunBody = z.object({
  args: z.string().default(''),
  /** Continue an existing claude conversation (from a prior session-started event). */
  resumeSessionId: z.string().min(1).optional(),
  /**
   * Identifies the source unit this run will process so the server can
   * record an observation against it after the run completes
   * successfully. Studio sends this when the user picks an option from
   * the `source-intent` provider. Only `braid-extract` consumes it
   * today; other skills ignore it.
   */
  sourceUnit: SourceUnitRef.optional(),
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
  /**
   * When set, a successful manual `braid-extract` run carrying a
   * `sourceUnit` body field records an observation against that unit.
   * Without it the dispatch still works; observations only ever come
   * from BatchService. The hook is hard-coded to `braid-extract` per
   * the v0 scope of issue #31.
   */
  readonly sourceUnitStateService?: SourceUnitStateService
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
    403: {
      description: 'Caller is not permitted to run this skill in this workspace.',
      content: { 'application/problem+json': { schema: z.object({}).passthrough() } },
    },
    404: NotFoundResponse,
  },
})

export function createSkillsRouter(deps: SkillsRouterDeps): OpenAPIHono {
  const router = new OpenAPIHono()

  // skill.run is the only capability that needs a per-request resource
  // (the skill manifest). The resource builder fetches the workspace +
  // manifest once and hands the result to the policy check.
  router.use('/:skillId/run', requirePermission('skill.run', async (context) => {
    const workspace = await loadWorkspaceById(getWorkspaceId(context), deps.workspaceRepository)
    const skillId = SkillIdSchema.parse(context.req.param('skillId'))
    const manifest = await deps.skillRegistry.get(workspace, skillId)
    return { skill: manifest.toData().frontmatter, skillId }
  }))

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
    const { args, resumeSessionId, sourceUnit } = context.req.valid('json')
    const callerToken = extractBearerToken(context)
    const options = {
      ...(resumeSessionId ? { resumeSessionId } : {}),
      ...(callerToken ? { callerToken } : {}),
    }
    const runId = await deps.skillRunner.start(workspace, skillId, args, options)

    // v0 of #31: only braid-extract participates in observation
    // recording, only when the caller named a source unit. The hook
    // runs in the background so the route still returns 202 promptly;
    // failures (skill error, cancel, repository write) are logged but
    // do not bubble up to the client.
    if (sourceUnit && skillId === BRAID_EXTRACT_SKILL_ID && deps.sourceUnitStateService) {
      void recordObservationOnSuccess({
        runner: deps.skillRunner,
        sourceUnitStateService: deps.sourceUnitStateService,
        workspace,
        runId,
        sourceUnit,
      })
    }

    return context.json({ runId }, 202)
  })

  return router
}

const recordLogger = createLogger('skills.recordObservation')

interface RecordObservationParams {
  readonly runner: SkillRunner
  readonly sourceUnitStateService: SourceUnitStateService
  readonly workspace: Workspace
  readonly runId: SkillRunIdType
  readonly sourceUnit: { sourceId: SourceId, path: string }
}

/**
 * Subscribe to a run, wait for it to terminate, and record a
 * SourceUnitState observation iff the run finished cleanly (exit code
 * 0). Cancellation or any non-zero exit short-circuits so the previous
 * recorded state is preserved.
 */
async function recordObservationOnSuccess(params: RecordObservationParams): Promise<void> {
  const { runner, sourceUnitStateService, workspace, runId, sourceUnit } = params
  try {
    const outcome = await new Promise<'success' | 'failure'>((resolve) => {
      const sub = runner.subscribe(runId, (event: SkillEvent) => {
        if (event.type === 'completed') {
          sub.unsubscribe()
          resolve(event.exitCode === 0 ? 'success' : 'failure')
        }
        else if (event.type === 'error') {
          sub.unsubscribe()
          resolve('failure')
        }
      })
    })
    if (outcome !== 'success')
      return
    await sourceUnitStateService.recordObservation(
      workspace.id,
      sourceUnit.sourceId,
      sourceUnit.path,
      runId,
    )
  }
  catch (err) {
    recordLogger.warn({
      runId,
      workspaceId: workspace.id,
      sourceId: sourceUnit.sourceId,
      path: sourceUnit.path,
      err: (err as Error).message,
    }, 'failed to record observation after braid-extract run')
  }
}
