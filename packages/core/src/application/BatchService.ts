import type {
  BatchInputMode,
  BatchPlan as BatchPlanData,
  BatchUnit,
  BatchUnitId,
  ClarifyTicketId,
  ProposalId,
  SkillEvent,
  SkillRunId,
  Timestamp,
  WorkspaceEvent,
  WorkspaceId,
} from '@braidhq/schema'
import type { BatchPlanRepository } from '../domain/batch/BatchPlanRepository.js'
import type { Clock } from '../domain/Clock.js'
import type { ClarifyTicketRepository } from '../domain/hitl/ClarifyTicketRepository.js'
import type { ProposalRepository } from '../domain/hitl/ProposalRepository.js'
import type { OntologyBatchBinding, OntologyPlugin } from '../domain/plugin/OntologyPlugin.js'
import type { PluginRegistry } from '../domain/plugin/PluginRegistry.js'
import type { SkillRunner } from '../domain/skill/SkillRunner.js'
import type { Workspace } from '../domain/workspace/Workspace.js'
import type { HistoryService } from './HistoryService.js'
import type { HITLService } from './HITLService.js'
import type { SourceUnitObservationService } from './SourceUnitObservationService.js'
import type { WorkspaceEventBus } from './WorkspaceEventBus.js'
import type { WorkspaceLock } from './WorkspaceLock.js'
import type { WorkspaceService } from './WorkspaceService.js'
import { UserId } from '@braidhq/schema'
import { BatchPlan } from '../domain/batch/BatchPlan.js'
import { ConflictError, ValidationError } from '../domain/errors.js'
import { newBatchPlanId, newBatchUnitId } from '../domain/ids.js'

const BATCH_USER_ID = UserId.parse('braid-batch')

export interface IntentItem {
  readonly value: string
  readonly label: string
  readonly sourceId: string
  readonly sourceName: string
}

export type IntentLister = (workspace: Workspace) => Promise<readonly IntentItem[]>

export interface BatchServiceDeps {
  workspaceService: WorkspaceService
  skillRunner: SkillRunner
  proposalRepository: ProposalRepository
  clarifyRepository: ClarifyTicketRepository
  historyService: HistoryService
  hitlService: HITLService
  batchPlanRepository: BatchPlanRepository
  // Filesystem walk happens in infrastructure. The orchestrator just consumes the list.
  intentLister: IntentLister
  /**
   * Resolves the workspace's ontology plugin so the service can read its batch binding (per-unit skill,
   * checkpoint config, derive skill).
   * Without this binding the framework has no opinion on which skills to dispatch.
   */
  pluginRegistry: PluginRegistry
  eventBus?: WorkspaceEventBus
  workspaceLock: WorkspaceLock
  clock: Clock
  /**
   * Optional. When supplied,
   * batch records a `SourceUnitObservation` observation after every successful unit extract,
   * so Reactor / manual paths share the same diff primitive.
   * Absent in pure unit-test wiring. Production composition (`composeFsApp`) always provides it.
   */
  sourceUnitObservationService?: SourceUnitObservationService
}

export interface StartBatchOptions {
  autoApply: boolean
  /**
   * Bearer token captured from the caller's session,
   * forwarded to every skill subprocess this batch spawns,
   * so they can call back into the server API via the braid-core MCP gateway.
   * Absent when running in `BRAID_LOCAL_TRUST=true` mode (anonymous local dev),
   * where the auth middleware lets unauthenticated callers through.
   */
  callerToken?: string
}

export class BatchService {
  private readonly stopRequested = new Set<WorkspaceId>()

  constructor(private readonly deps: BatchServiceDeps) {}

  async start(workspaceId: WorkspaceId, options: StartBatchOptions): Promise<BatchPlan> {
    return this.deps.workspaceLock.run(workspaceId, async () => {
      const workspace = await this.deps.workspaceService.findById(workspaceId)
      await this.assertNoActiveBatch(workspace)
      const ontology = this.resolveOntology(workspace)
      const binding = this.requireBinding(ontology)
      const mode = this.resolveMode(workspace, binding)
      const now = this.deps.clock.now()
      const baselineTag = `batch-baseline-${tagSuffix(now)}`
      const initialUnits = mode === 'intent' ? await this.buildIntentUnits(workspace) : []
      if (mode === 'intent' && initialUnits.length === 0) {
        throw new ValidationError(
          `Workspace "${workspace.id}" has intent sources registered but no intent documents inside them.`,
        )
      }

      const plan = new BatchPlan({
        id: newBatchPlanId(),
        workspaceId,
        createdAt: now,
        updatedAt: now,
        mode,
        status: 'idle',
        autoApply: options.autoApply,
        units: initialUnits,
        checkpointPhases: [],
        batchPolicy: snapshotBatchPolicy(binding),
      }).beginRun(now, baselineTag)

      await this.tagBaseline(workspace, baselineTag, now)
      await this.deps.batchPlanRepository.save(workspace, plan)
      this.publish(workspaceId, { type: 'batch.started', workspaceId, planId: plan.id, mode, at: now })

      // Fire-and-forget. Callers poll via getStatus or subscribe to SSE.
      void this.runLoop(workspace, plan, options.callerToken).catch(async (err: unknown) => {
        const failed = (await this.deps.batchPlanRepository.load(workspace))
          ?.markFailed(this.deps.clock.now(), errorMessage(err))
        if (failed)
          await this.deps.batchPlanRepository.save(workspace, failed)
        this.publish(workspaceId, {
          type: 'batch.failed',
          workspaceId,
          planId: plan.id,
          error: errorMessage(err),
          at: this.deps.clock.now(),
        })
      })

      return plan
    })
  }

  // Promote stale running plans to failed at boot, so the UI never shows a frozen spinner from a previous crash.
  async reconcileAfterBoot(workspaceId: WorkspaceId): Promise<void> {
    const workspace = await this.deps.workspaceService.findById(workspaceId)
    const plan = await this.deps.batchPlanRepository.load(workspace)
    if (!plan)
      return
    if (plan.status !== 'running' && plan.status !== 'deriving')
      return
    if (plan.running && this.deps.skillRunner.isActive(plan.running.skillRunId))
      return
    const failed = plan.markFailed(this.deps.clock.now(), 'Batch was interrupted by a server restart.')
    await this.deps.batchPlanRepository.save(workspace, failed)
  }

  async resume(workspaceId: WorkspaceId, options: { callerToken?: string } = {}): Promise<BatchPlan> {
    return this.deps.workspaceLock.run(workspaceId, async () => {
      const workspace = await this.deps.workspaceService.findById(workspaceId)
      const existingPlan = await this.deps.batchPlanRepository.load(workspace)
      if (!existingPlan)
        throw new ValidationError(`No batch plan to resume on workspace "${workspaceId}"`)
      const now = this.deps.clock.now()
      const resumedPlan = existingPlan.resumeRun(now)
      this.stopRequested.delete(workspaceId)
      await this.deps.batchPlanRepository.save(workspace, resumedPlan)
      this.publish(workspaceId, {
        type: 'batch.started',
        workspaceId,
        planId: resumedPlan.id,
        mode: resumedPlan.mode,
        at: now,
      })
      void this.runLoop(workspace, resumedPlan, options.callerToken).catch(async (err: unknown) => {
        const failed = (await this.deps.batchPlanRepository.load(workspace))
          ?.markFailed(this.deps.clock.now(), errorMessage(err))
        if (failed)
          await this.deps.batchPlanRepository.save(workspace, failed)
        this.publish(workspaceId, {
          type: 'batch.failed',
          workspaceId,
          planId: resumedPlan.id,
          error: errorMessage(err),
          at: this.deps.clock.now(),
        })
      })
      return resumedPlan
    })
  }

  async getStatus(workspaceId: WorkspaceId): Promise<BatchPlan | null> {
    const workspace = await this.deps.workspaceService.findById(workspaceId)
    return this.deps.batchPlanRepository.load(workspace)
  }

  async stop(workspaceId: WorkspaceId): Promise<void> {
    this.stopRequested.add(workspaceId)
    const workspace = await this.deps.workspaceService.findById(workspaceId)
    const plan = await this.deps.batchPlanRepository.load(workspace)
    if (!plan?.running)
      return
    // Orphan runId (server restart between unit start and Stop). No subprocess to SIGTERM, mark the plan failed inline.
    if (this.deps.skillRunner.isActive(plan.running.skillRunId)) {
      await this.deps.skillRunner.cancel(plan.running.skillRunId)
      return
    }
    const failed = plan.markFailed(this.deps.clock.now(), 'Batch was interrupted by a server restart.')
    await this.deps.batchPlanRepository.save(workspace, failed)
    this.publish(workspaceId, {
      type: 'batch.failed',
      workspaceId,
      planId: plan.id,
      error: 'Batch was interrupted by a server restart.',
      at: this.deps.clock.now(),
    })
  }

  // Move a terminal plan to `archived`. The Studio Batch page treats it like no active plan,
  // but keeps the report browsable in the PreStart slot.
  // Recorded in git history as a `batch-archive` commit.
  async archive(workspaceId: WorkspaceId): Promise<BatchPlan> {
    return this.deps.workspaceLock.run(workspaceId, async () => {
      const workspace = await this.deps.workspaceService.findById(workspaceId)
      const existingPlan = await this.deps.batchPlanRepository.load(workspace)
      if (!existingPlan)
        throw new ValidationError(`No batch plan to archive on workspace "${workspaceId}"`)
      const archivedPlan = existingPlan.archive(this.deps.clock.now())
      await this.deps.batchPlanRepository.save(workspace, archivedPlan)
      await this.deps.historyService.commitWorkspaceChange(workspace.id, {
        kind: 'batch-archive',
        subject: `archived ${archivedPlan.id}`,
        userId: BATCH_USER_ID,
      })
      return archivedPlan
    })
  }

  private async runLoop(workspace: Workspace, initial: BatchPlan, callerToken?: string): Promise<void> {
    let plan = initial
    const binding = this.requireBinding(this.resolveOntology(workspace))
    if (plan.mode === 'derive') {
      plan = await this.runDerivePhase(workspace, plan, binding, callerToken)
      if (plan.status !== 'running')
        return
    }
    for (const unit of plan.units) {
      // Skip completed units so Resume only re-runs pending ones.
      // The failed to pending move was already done by resumeRun().
      if (unit.status === 'completed')
        continue
      if (this.shouldStop(workspace.id)) {
        plan = plan.markStopped(this.deps.clock.now())
        await this.deps.batchPlanRepository.save(workspace, plan)
        this.publish(workspace.id, {
          type: 'batch.stopped',
          workspaceId: workspace.id,
          planId: plan.id,
          at: this.deps.clock.now(),
        })
        return
      }
      plan = await this.runUnit(workspace, plan, binding, unit, callerToken)
      // Fire a checkpoint when the ontology's chunkSize threshold is crossed.
      // A failed checkpoint fails the batch immediately,
      // so we stop dispatching runs into a model state we know is broken.
      if (binding.checkpoint) {
        const unconsumed = unconsumedCompletedUnitIds(plan)
        if (unconsumed.length >= binding.checkpoint.chunkSize) {
          const chunkUnitIds = unconsumed.slice(0, binding.checkpoint.chunkSize)
          const after = await this.runCheckpointPhase(workspace, plan, binding.checkpoint, chunkUnitIds, callerToken)
          if (after.status === 'failed')
            return
          plan = after
        }
      }
    }
    // Optional end-of-loop checkpoint. The ontology decides whether to require it (`runAtEnd: true`).
    // Some ontologies rely purely on per-chunk checkpoints, others skip checkpoints entirely.
    if (binding.checkpoint?.runAtEnd) {
      const remainingUnits = unconsumedCompletedUnitIds(plan)
      const after = await this.runCheckpointPhase(workspace, plan, binding.checkpoint, remainingUnits, callerToken)
      if (after.status === 'failed')
        return
      plan = after
    }
    const now = this.deps.clock.now()
    const completedPlan = plan.markCompleted(now)
    await this.deps.batchPlanRepository.save(workspace, completedPlan)
    this.publish(workspace.id, {
      type: 'batch.completed',
      workspaceId: workspace.id,
      planId: completedPlan.id,
      at: now,
    })
  }

  private async runCheckpointPhase(
    workspace: Workspace,
    plan: BatchPlan,
    checkpoint: NonNullable<OntologyBatchBinding['checkpoint']>,
    unitIds: readonly BatchUnitId[],
    callerToken?: string,
  ): Promise<BatchPlan> {
    const unitsById = new Map(plan.units.map(unit => [unit.id, unit] as const))
    const units = unitIds.map(id => unitsById.get(id)).filter((unit): unit is BatchUnit => !!unit)
    const extraEnv = checkpoint.extraEnv?.(units)
    const hasEnv = !!extraEnv && Object.keys(extraEnv).length > 0
    let runId: SkillRunId | undefined
    try {
      const startedAt = this.deps.clock.now()
      // Snapshot proposal ids so the post-run sweep can attribute new ones, mirroring runUnit's set-difference.
      const before = await this.snapshotIds(workspace.id)
      runId = await this.deps.skillRunner.start(
        workspace,
        checkpoint.skillId,
        '',
        {
          ...(hasEnv ? { extraEnv } : {}),
          ...(callerToken ? { callerToken } : {}),
        },
      )
      const running = plan.startCheckpointPhase(startedAt, runId, unitIds)
      await this.deps.batchPlanRepository.save(workspace, running)
      this.publish(workspace.id, {
        type: 'batch.checkpoint.started',
        workspaceId: workspace.id,
        planId: running.id,
        skillRunId: runId,
        at: startedAt,
      })
      await this.runSkillWithAutoApply(workspace, runId, plan.autoApply, before)
      const completedAt = this.deps.clock.now()
      const completed = running.completeCheckpointPhase(completedAt)
      await this.deps.batchPlanRepository.save(workspace, completed)
      this.publish(workspace.id, {
        type: 'batch.checkpoint.completed',
        workspaceId: workspace.id,
        planId: completed.id,
        skillRunId: runId,
        at: completedAt,
      })
      return completed
    }
    catch (err) {
      const now = this.deps.clock.now()
      const errorText = `checkpoint "${checkpoint.skillId}" failed: ${errorMessage(err)}`
      const phaseFailed = (runId ? plan.startCheckpointPhase(now, runId, unitIds) : plan).failCheckpointPhase(now, errorText)
      const failed = phaseFailed.markFailed(now, errorText)
      await this.deps.batchPlanRepository.save(workspace, failed)
      if (runId) {
        this.publish(workspace.id, {
          type: 'batch.checkpoint.failed',
          workspaceId: workspace.id,
          planId: failed.id,
          skillRunId: runId,
          error: errorText,
          at: now,
        })
      }
      this.publish(workspace.id, {
        type: 'batch.failed',
        workspaceId: workspace.id,
        planId: failed.id,
        error: errorText,
        at: now,
      })
      return failed
    }
  }

  private async recordObservation(
    workspace: Workspace,
    unit: BatchUnit,
    runId: SkillRunId,
  ): Promise<void> {
    const service = this.deps.sourceUnitObservationService
    if (!service || !unit.sourceId || !unit.scopeHint)
      return
    try {
      await service.recordObservation(workspace.id, unit.sourceId, unit.scopeHint, runId)
    }
    catch {
      // Observation recording is best-effort. The extract itself already succeeded,
      // and failing to record it must not fail the batch.
      // Reactor sees the unit as changed next cycle and re-extracts,
      // which is a recoverable state.
    }
  }

  private async runDerivePhase(
    workspace: Workspace,
    _plan: BatchPlan,
    binding: OntologyBatchBinding,
    callerToken?: string,
  ): Promise<BatchPlan> {
    if (!binding.deriveUnits) {
      throw new ValidationError(
        `Workspace "${workspace.id}" has no intent source and the ontology "${this.resolveOntology(workspace).ontologyId}" provides no deriveUnits skill.`,
      )
    }
    const skillId = binding.deriveUnits.skillId
    const runId = await this.deps.skillRunner.start(workspace, skillId, '', callerToken ? { callerToken } : undefined)
    await waitForCompletion(this.deps.skillRunner, runId)
    const updated = await this.deps.batchPlanRepository.load(workspace)
    if (!updated)
      throw new Error('batch-plan.json disappeared during derive')
    if (updated.units.length === 0) {
      const failed = updated.markFailed(this.deps.clock.now(), `derive skill "${skillId}" produced no units`)
      await this.deps.batchPlanRepository.save(workspace, failed)
      return failed
    }
    const promoted = updated.promoteToRunning(this.deps.clock.now(), updated.units)
    await this.deps.batchPlanRepository.save(workspace, promoted)
    return promoted
  }

  private async runUnit(workspace: Workspace, plan: BatchPlan, binding: OntologyBatchBinding, unit: BatchUnit, callerToken?: string): Promise<BatchPlan> {
    const startedAt = this.deps.clock.now()
    let running = plan
    try {
      // Snapshot the pre-run id sets, so post-run additions can be attributed to this unit.
      const before = await this.snapshotIds(workspace.id)
      const argsFor = binding.perUnit.argsFor ?? defaultUnitArg
      const runId = await this.deps.skillRunner.start(
        workspace,
        binding.perUnit.skillId,
        argsFor(unit),
        callerToken ? { callerToken } : undefined,
      )
      running = plan.markUnitRunning(startedAt, unit.id, { unitId: unit.id, skillRunId: runId })
      await this.deps.batchPlanRepository.save(workspace, running)
      this.publish(workspace.id, {
        type: 'batch.unit.started',
        workspaceId: workspace.id,
        planId: plan.id,
        unitId: unit.id,
        unitName: unit.name,
        at: startedAt,
      })

      const output = await this.runSkillWithAutoApply(workspace, runId, plan.autoApply, before)

      const completedAt = this.deps.clock.now()
      const completed = running.markUnitCompleted(completedAt, unit.id, output)
      await this.deps.batchPlanRepository.save(workspace, completed)
      await this.recordObservation(workspace, unit, runId)
      this.publish(workspace.id, {
        type: 'batch.unit.completed',
        workspaceId: workspace.id,
        planId: plan.id,
        unitId: unit.id,
        applied: plan.autoApply ? output.proposalIds.length : 0,
        queued: output.clarifyTicketIds.length,
        at: completedAt,
      })
      return completed
    }
    catch (err) {
      const completedAt = this.deps.clock.now()
      const failed = running.markUnitFailed(completedAt, unit.id, errorMessage(err))
      await this.deps.batchPlanRepository.save(workspace, failed)
      this.publish(workspace.id, {
        type: 'batch.unit.failed',
        workspaceId: workspace.id,
        planId: plan.id,
        unitId: unit.id,
        error: errorMessage(err),
        at: completedAt,
      })
      return failed
    }
  }

  // Captures all statuses, so stream-applied proposals still appear in the after-vs-before diff.
  private async snapshotIds(workspaceId: WorkspaceId): Promise<{
    proposals: Set<ProposalId>
    clarify: Set<ClarifyTicketId>
  }> {
    const [proposals, clarify] = await Promise.all([
      this.deps.proposalRepository.list({ workspaceId }),
      this.deps.clarifyRepository.list({ workspaceId }),
    ])
    return {
      proposals: new Set(proposals.map(proposal => proposal.id)),
      clarify: new Set(clarify.map(ticket => ticket.id)),
    }
  }

  private async collectUnitOutput(workspaceId: WorkspaceId, before: { proposals: Set<ProposalId>, clarify: Set<ClarifyTicketId> }): Promise<{
    proposalIds: ProposalId[]
    clarifyTicketIds: ClarifyTicketId[]
  }> {
    const after = await this.snapshotIds(workspaceId)
    return {
      proposalIds: [...after.proposals].filter(id => !before.proposals.has(id)),
      clarifyTicketIds: [...after.clarify].filter(id => !before.clarify.has(id)),
    }
  }

  // Drives a single skill run end to end with autoApply wiring. Streams proposals as they're created,
  // waits for the subprocess to exit, then sweeps anything the stream missed.
  // Shared by runUnit and runCheckpointPhase so both get the same autoApply.
  private async runSkillWithAutoApply(
    workspace: Workspace,
    runId: SkillRunId,
    autoApply: boolean,
    before: { proposals: Set<ProposalId>, clarify: Set<ClarifyTicketId> },
  ): Promise<{ proposalIds: ProposalId[], clarifyTicketIds: ClarifyTicketId[] }> {
    const applied = new Set<ProposalId>()
    const unsubscribe = autoApply
      ? this.streamApplyProposals(workspace.id, applied)
      : () => {}
    try {
      await waitForCompletion(this.deps.skillRunner, runId)
    }
    finally {
      unsubscribe()
    }
    const output = await this.collectUnitOutput(workspace.id, before)
    if (autoApply) {
      const remaining = output.proposalIds.filter(id => !applied.has(id))
      await this.autoApply(remaining)
    }
    return output
  }

  private streamApplyProposals(workspaceId: WorkspaceId, applied: Set<ProposalId>): () => void {
    if (!this.deps.eventBus)
      return () => {}
    return this.deps.eventBus.subscribe(workspaceId, (event) => {
      if (event.type !== 'proposal.created')
        return
      if (applied.has(event.proposalId))
        return
      applied.add(event.proposalId)
      // Fire-and-forget. HITLService's lock sequences this behind the submit that emitted it.
      void this.deps.hitlService.applyProposal(event.proposalId, BATCH_USER_ID).catch(() => {
        // Validation race or conflict, the post-unit sweep retries.
        applied.delete(event.proposalId)
      })
    })
  }

  private async autoApply(proposalIds: readonly ProposalId[]): Promise<void> {
    for (const id of proposalIds) {
      try {
        await this.deps.hitlService.applyProposal(id, BATCH_USER_ID)
      }
      catch {
        // Skip on conflict, e.g. a validation error against the latest snapshot. The proposal stays pending.
      }
    }
  }

  private async assertNoActiveBatch(workspace: Workspace): Promise<void> {
    const existingPlan = await this.deps.batchPlanRepository.load(workspace)
    if (existingPlan && (existingPlan.status === 'running' || existingPlan.status === 'deriving')) {
      throw new ConflictError(
        `Workspace "${workspace.id}" already has an active batch (plan ${existingPlan.id} status=${existingPlan.status})`,
      )
    }
  }

  private resolveMode(workspace: Workspace, binding: OntologyBatchBinding): BatchInputMode {
    if (workspace.intentSources().length > 0)
      return 'intent'
    if (workspace.codeSources().length > 0) {
      if (!binding.deriveUnits) {
        throw new ValidationError(
          `Workspace "${workspace.id}" has no intent source; ontology "${workspace.productManifest.ontologyId}" must provide a deriveUnits skill to batch from code.`,
        )
      }
      return 'derive'
    }
    throw new ValidationError(
      `Workspace "${workspace.id}" has no intent or code sources to bootstrap from`,
    )
  }

  private resolveOntology(workspace: Workspace): OntologyPlugin {
    return this.deps.pluginRegistry.requireOntology(workspace.productManifest.ontologyId)
  }

  private requireBinding(ontology: OntologyPlugin): OntologyBatchBinding {
    if (!ontology.batch) {
      throw new ValidationError(
        `Ontology "${ontology.ontologyId}" does not declare a batch binding; it cannot participate in batches.`,
      )
    }
    return ontology.batch
  }

  private async buildIntentUnits(workspace: Workspace): Promise<BatchUnit[]> {
    const items = await this.deps.intentLister(workspace)
    return items.map(item => ({
      id: newBatchUnitId(),
      name: item.label,
      description: `Intent doc from ${item.sourceName}`,
      sourceId: item.sourceId as never,
      scopeHint: item.value,
      status: 'pending' as const,
      proposalIds: [],
      clarifyTicketIds: [],
    }))
  }

  private async tagBaseline(workspace: Workspace, name: string, now: Timestamp): Promise<void> {
    const head = await this.deps.historyService.listCommits(workspace.id, { limit: 1 })
    const sha = head[0]?.sha
    if (!sha)
      return
    await this.deps.historyService.createTag(workspace.id, sha, name, `bootstrap baseline at ${now}`)
  }

  private shouldStop(workspaceId: WorkspaceId): boolean {
    if (!this.stopRequested.has(workspaceId))
      return false
    this.stopRequested.delete(workspaceId)
    return true
  }

  private publish(_workspaceId: WorkspaceId, event: WorkspaceEvent): void {
    this.deps.eventBus?.publish(event)
  }
}

function defaultUnitArg(unit: BatchUnit): string {
  return unit.scopeHint ?? unit.name
}

function tagSuffix(now: Timestamp): string {
  return now.replace(/[:.]/g, '-')
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Returns the ordered list of unit ids that are `completed` on the plan,
 * but have not yet been recorded as `unitIds` in any successful model phase.
 * Order matches `plan.units` so the chunking inside the run loop processes them in extraction order.
 */
function snapshotBatchPolicy(binding: OntologyBatchBinding): NonNullable<BatchPlanData['batchPolicy']> {
  return {
    perUnitSkillId: binding.perUnit.skillId,
    ...(binding.perUnit.label ? { perUnitLabel: binding.perUnit.label } : {}),
    ...(binding.checkpoint
      ? {
          checkpointSkillId: binding.checkpoint.skillId,
          ...(binding.checkpoint.label ? { checkpointLabel: binding.checkpoint.label } : {}),
          checkpointChunkSize: binding.checkpoint.chunkSize,
          checkpointRunAtEnd: binding.checkpoint.runAtEnd,
        }
      : {}),
  }
}

function unconsumedCompletedUnitIds(plan: BatchPlan): readonly BatchUnitId[] {
  const consumed = new Set<BatchUnitId>()
  for (const phase of plan.checkpointPhases) {
    if (phase.status === 'completed') {
      for (const id of phase.unitIds)
        consumed.add(id)
    }
  }
  return plan.units.filter(unit => unit.status === 'completed' && !consumed.has(unit.id)).map(unit => unit.id)
}

async function waitForCompletion(runner: SkillRunner, runId: SkillRunId): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const sub = runner.subscribe(runId, (event: SkillEvent) => {
      if (event.type === 'completed') {
        sub.unsubscribe()
        if (event.exitCode === 0)
          resolve()
        else
          reject(new Error(`skill exited with code ${event.exitCode}`))
      }
      else if (event.type === 'error') {
        sub.unsubscribe()
        reject(new Error(event.message || 'skill error'))
      }
    })
  })
}
