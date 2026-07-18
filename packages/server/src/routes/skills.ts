import type {
  PluginRegistry,
  RunRepository,
  SkillRegistry,
  SkillRunner,
  SourceUnitObservationService,
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
  // Continue a prior claude conversation from a session-started event.
  resumeSessionId: z.string().min(1).optional(),
  // Identifies the source unit this run will process,
  // so the server records an observation against it after a clean run.
  // Studio sends this when the user picks a `source-intent` option.
  // Only `braid-extract` consumes it today, other skills ignore it.
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
   * Records a SourceUnitObservation after a successful per-unit run,
   * named by the active ontology's `perUnit.skillId` binding.
   */
  readonly sourceUnitObservationService: SourceUnitObservationService
  /**
   * Backfills a run's terminal exit state.
   * A run can finish after `skillRunner.start` returns,
   * but before the hook subscribes, missing the terminal event.
   * Without it the hook only listens forward, so that race leaks silently.
   */
  readonly runRepository: RunRepository
  /**
   * Resolves the active ontology for the workspace,
   * so the route reads its `batch.perUnit.skillId`,
   * instead of hard-coding the extract skill.
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

  // skill.run is the only capability needing a per-request resource,
  // the skill manifest.
  // The builder fetches workspace and manifest once,
  // then hands the result to the policy check.
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
      // sourceUnit is only for the ontology's per-unit step,
      // so reject it for any other skill.
      // Otherwise the run-skill route advertises support uniformly,
      // then silently drops it for every skill except extract.
      if (!perUnitSkillId || skillId !== perUnitSkillId) {
        throw new ValidationError(
          perUnitSkillId
            ? `sourceUnit is only accepted for "${perUnitSkillId}" (the active ontology's per-unit skill)`
            : `sourceUnit is not accepted: the active ontology declares no per-unit skill`,
        )
      }
      // Reject a sourceUnit whose sourceId is not an intent source here.
      // Recording against a ghost sourceId would pollute the ledger,
      // and confuse the Reactor and BatchService diff.
      const known = workspace.sources.find(s => s.id === sourceUnit.sourceId && s.role === 'intent')
      if (!known)
        throw new ValidationError(`Source-unit id "${sourceUnit.sourceId}" does not name an intent source in workspace "${workspace.id}"`)
    }

    const runId = await deps.skillRunner.start(workspace, skillId, args, options)

    // The observation hook runs in the background,
    // so the route still returns 202 promptly.
    // Any failure (skill error, cancel, repository write) is logged,
    // but does not bubble up to the client.
    if (sourceUnit && perUnitSkillId && skillId === perUnitSkillId) {
      void recordObservationOnSuccess({
        runner: deps.skillRunner,
        runRepository: deps.runRepository,
        sourceUnitObservationService: deps.sourceUnitObservationService,
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

// Stop waiting after this many ms, even if no terminal event arrives.
// Real braid-extract runs settle in seconds to minutes.
// This backstops orphan subscriptions on crashed runners,
// or upstream queues that quietly drop events.
const OBSERVATION_TIMEOUT_MS = 60 * 60 * 1000

interface RecordObservationParams {
  readonly runner: SkillRunner
  readonly runRepository: RunRepository
  readonly sourceUnitObservationService: SourceUnitObservationService
  readonly workspace: Workspace
  readonly runId: SkillRunIdType
  readonly sourceUnit: { sourceId: SourceId, path: string }
}

// Subscribe to a run and wait for it to terminate.
// Record a SourceUnitObservation only if it exits cleanly (code 0).
// On cancellation, non-zero exit, error, or timeout,
// the previously recorded state is left untouched.
//
// Two race-safety measures matter here.
// First, we subscribe before checking `isActive`.
// A run finishing between those steps would miss the terminal event,
// so we backfill from the persisted RunRecord exit code.
// Second, the Promise has a hard timeout.
// A run that never emits a terminal event cannot leak the closure.
async function recordObservationOnSuccess(params: RecordObservationParams): Promise<void> {
  const { runner, runRepository, sourceUnitObservationService, workspace, runId, sourceUnit } = params
  const workspaceId = workspace.id
  try {
    const outcome = await waitForTerminalOutcome(runner, runRepository, workspace, runId)
    if (outcome !== 'success')
      return
    await sourceUnitObservationService.recordObservation(
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

    // Subscribe first, so future events from a still-active run reach us.
    // Checking `isActive` first would race.
    // A run finishing between the two steps would miss the terminal event.
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

    // Backfill for an already-finished run.
    // Its subscription never receives a terminal event,
    // because the runner clears subscribers when drain exits.
    // Read the persisted RunRecord instead.
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

    // Timeout backstop. .unref() lets Node exit while the timer pends.
    // Observation recording is best-effort,
    // not a reason to hold the process open.
    timeout = setTimeout(() => settle('failure'), OBSERVATION_TIMEOUT_MS)
    timeout.unref?.()
  })
}
