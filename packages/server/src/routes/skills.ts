import type {
  PluginRegistry,
  RunRepository,
  SkillRegistry,
  SkillRunner,
  SourceUnitStateService,
  Workspace,
  WorkspaceRepository,
} from '@braidhq/core'
import type { SkillEvent, SkillId, SkillRunId as SkillRunIdType } from '@braidhq/schema'
import { createLogger, ValidationError } from '@braidhq/core'
import { SkillId as SkillIdSchema, SkillManifest, SkillRunId, SourceId } from '@braidhq/schema'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { extractBearerToken } from '../middleware/auth.js'
import { requirePermission } from '../middleware/workspaceAccess.js'
import { getWorkspaceId } from '../middleware/workspaceId.js'
import { NotFoundResponse, WorkspaceIdParam } from './_shared.js'
import { loadWorkspaceById } from './helpers.js'

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
   * Used to record a SourceUnitState observation after a successful
   * per-unit skill run (the one named by the active ontology's
   * `OntologyBatchBinding.perUnit.skillId`).
   */
  readonly sourceUnitStateService: SourceUnitStateService
  /**
   * Used to backfill terminal exit state for runs that finished between
   * `skillRunner.start` returning and the observation hook subscribing;
   * without it the hook would only listen for future events and races
   * would become silent leaks.
   */
  readonly runRepository: RunRepository
  /**
   * Resolves the active ontology for the workspace so the route can
   * read its `batch.perUnit.skillId` instead of hard-coding the DDD
   * extract skill name.
   */
  readonly pluginRegistry: PluginRegistry
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
    const perUnitSkillId = resolvePerUnitSkillId(deps.pluginRegistry, workspace)

    if (sourceUnit) {
      // Reject sourceUnit for skills the active ontology does not
      // dispatch as its per-unit step. The shared run-skill route
      // would otherwise advertise sourceUnit support uniformly while
      // silently dropping it for everything except the extract skill.
      if (!perUnitSkillId || skillId !== perUnitSkillId) {
        throw new ValidationError(
          perUnitSkillId
            ? `sourceUnit is only accepted for "${perUnitSkillId}" (the active ontology's per-unit skill)`
            : `sourceUnit is not accepted: the active ontology declares no per-unit skill`,
        )
      }
      // Reject sourceUnit references that name a sourceId not present
      // in the workspace as an intent source. Recording against a
      // ghost sourceId would pollute the ledger and confuse the
      // Reactor and BatchService diff.
      const known = workspace.sources.find(s => s.id === sourceUnit.sourceId && s.role === 'intent')
      if (!known)
        throw new ValidationError(`sourceUnit.sourceId "${sourceUnit.sourceId}" does not name an intent source in workspace "${workspace.id}"`)
    }

    const runId = await deps.skillRunner.start(workspace, skillId, args, options)

    // The observation hook runs in the background so the route still
    // returns 202 promptly; failures (skill error, cancel, repository
    // write) are logged but do not bubble up to the client.
    if (sourceUnit && perUnitSkillId && skillId === perUnitSkillId) {
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

function resolvePerUnitSkillId(pluginRegistry: PluginRegistry, workspace: Workspace): SkillId | undefined {
  const ontology = pluginRegistry.findOntology(workspace.productManifest.ontologyId)
  return ontology?.batch?.perUnit?.skillId
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
