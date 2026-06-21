import type {
  RunRepository,
  SkillRegistry,
  SkillRunner,
  SourceUnitStateService,
  Workspace,
  WorkspaceRepository,
} from '@braidhq/core'
import type { SkillEvent, SkillRunId as SkillRunIdType } from '@braidhq/schema'
import { createLogger, ValidationError } from '@braidhq/core'
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
  /**
   * Needed to backfill terminal exit state for runs that finished
   * between `skillRunner.start` returning and the observation hook
   * subscribing. Without it the hook only listens for future events
   * and races become silent leaks.
   */
  readonly runRepository?: RunRepository
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
    // Reject malformed sourceUnit references early. Recording an
    // observation against a sourceId that does not belong to a real
    // intent source in the workspace would pollute the ledger and
    // confuse downstream readers (Reactor, BatchService diff).
    if (sourceUnit) {
      const known = workspace.sources.find(s => s.id === sourceUnit.sourceId && s.role === 'intent')
      if (!known)
        throw new ValidationError(`sourceUnit.sourceId "${sourceUnit.sourceId}" does not name an intent source in workspace "${workspace.id}"`)
    }

    const runId = await deps.skillRunner.start(workspace, skillId, args, options)

    // v0 of #31: only braid-extract participates in observation
    // recording, only when the caller named a source unit. The hook
    // runs in the background so the route still returns 202 promptly;
    // failures (skill error, cancel, repository write) are logged but
    // do not bubble up to the client.
    if (
      sourceUnit
      && skillId === BRAID_EXTRACT_SKILL_ID
      && deps.sourceUnitStateService
      && deps.runRepository
    ) {
      void recordObservationOnSuccess({
        runner: deps.skillRunner,
        runRepository: deps.runRepository,
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

// Stop waiting after this many ms even if the runner never produces a
// terminal event. Real braid-extract runs settle in seconds to minutes;
// this is a backstop against orphan subscriptions on crashed runners or
// upstream queues that quietly drop events.
const OBSERVATION_TIMEOUT_MS = 60 * 60 * 1000

interface RecordObservationParams {
  readonly runner: SkillRunner
  readonly runRepository: RunRepository
  readonly sourceUnitStateService: SourceUnitStateService
  readonly workspace: Workspace
  readonly runId: SkillRunIdType
  readonly sourceUnit: { sourceId: SourceId, path: string }
}

/**
 * Subscribe to a run, wait for it to terminate, and record a
 * SourceUnitState observation iff the run finished cleanly (exit code
 * 0). Cancellation, non-zero exit, error event, or timeout all leave
 * the previously recorded state untouched.
 *
 * Two race-safety measures matter here. First, the subscription is
 * attached before checking `isActive`: if the run finished between
 * those two operations, the subscription would have missed the
 * terminal event, so we backfill by reading the persisted RunRecord
 * for its exit code. Second, the Promise has a hard timeout so a run
 * that never emits a terminal event (orphaned subprocess, restarted
 * server, queue corruption) does not leak the subscription closure
 * indefinitely.
 */
async function recordObservationOnSuccess(params: RecordObservationParams): Promise<void> {
  const { runner, runRepository, sourceUnitStateService, workspace, runId, sourceUnit } = params
  const workspaceId = workspace.id
  try {
    const outcome = await waitForTerminalOutcome(runner, runRepository, workspace, runId)
    if (outcome !== 'success')
      return
    await sourceUnitStateService.recordObservation(
      workspaceId,
      sourceUnit.sourceId,
      sourceUnit.path,
      runId,
    )
  }
  catch (err) {
    recordLogger.warn({
      runId,
      workspaceId,
      sourceId: sourceUnit.sourceId,
      path: sourceUnit.path,
      err: err instanceof Error ? err.message : String(err),
    }, 'failed to record observation after braid-extract run')
  }
}

type RunOutcome = 'success' | 'failure'

async function waitForTerminalOutcome(
  runner: SkillRunner,
  runRepository: RunRepository,
  workspace: Workspace,
  runId: SkillRunIdType,
): Promise<RunOutcome> {
  return new Promise<RunOutcome>((resolve) => {
    let settled = false
    let timeout: ReturnType<typeof setTimeout> | undefined

    // Subscribe first so future events from a still-active run reach
    // us. If we checked `isActive` first and the run finished between
    // the two operations we would silently miss the terminal event.
    const sub = runner.subscribe(runId, (event: SkillEvent) => {
      if (event.type === 'completed')
        settle(event.exitCode === 0 ? 'success' : 'failure')
      else if (event.type === 'error')
        settle('failure')
    })

    function settle(outcome: RunOutcome): void {
      if (settled)
        return
      settled = true
      sub.unsubscribe()
      if (timeout)
        clearTimeout(timeout)
      resolve(outcome)
    }

    // Backfill: if the run already finished, the subscription will
    // never receive a terminal event because the runner clears its
    // subscriber set when drain exits. Read the persisted RunRecord
    // instead.
    if (!runner.isActive(runId)) {
      ;(async () => {
        try {
          const records = await runRepository.listRecords(workspace)
          const record = records.find(r => r.runId === runId)
          if (record?.exitCode !== undefined)
            settle(record.exitCode === 0 ? 'success' : 'failure')
          else
            settle('failure')
        }
        catch {
          settle('failure')
        }
      })()
    }

    // Timeout backstop. .unref() so Node can exit while the timer is
    // pending — observation recording is best-effort, not a reason to
    // hold the process open.
    timeout = setTimeout(() => settle('failure'), OBSERVATION_TIMEOUT_MS)
    timeout.unref?.()
  })
}
