import type {
  BatchInputMode,
  ClarifyTicketId,
  PlanUnit,
  ProposalId,
  SkillEvent,
  SkillId,
  SkillRunId,
  Timestamp,
  UserId,
  WorkspaceId,
} from '@braidhq/schema'
import type { BatchPlanRepository } from '../domain/batch/BatchPlanRepository.js'
import type { Clock } from '../domain/Clock.js'
import type { WorkspaceEvent } from '../domain/events/WorkspaceEvent.js'
import type { ClarifyTicketRepository } from '../domain/hitl/ClarifyTicketRepository.js'
import type { ProposalRepository } from '../domain/hitl/ProposalRepository.js'
import type { SkillRunner } from '../domain/skill/SkillRunner.js'
import type { Workspace } from '../domain/workspace/Workspace.js'
import type { HistoryService } from './HistoryService.js'
import type { HITLService } from './HITLService.js'
import type { PerWorkspaceLock } from './PerWorkspaceLock.js'
import type { WorkspaceEventBus } from './WorkspaceEventBus.js'
import type { WorkspaceService } from './WorkspaceService.js'
import { BatchPlan } from '../domain/batch/BatchPlan.js'
import { ConflictError, ValidationError } from '../domain/errors.js'
import { newBatchPlanId, newPlanUnitId } from '../domain/ids.js'

const BATCH_USER_ID = 'braid-batch' as UserId
const SCAN_SKILL_ID = 'braid-scan' as SkillId
const EXTRACT_SKILL_ID = 'braid-extract' as SkillId

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
  // Filesystem walk happens in infrastructure; the orchestrator just consumes the list.
  intentLister: IntentLister
  eventBus?: WorkspaceEventBus
  workspaceLock: PerWorkspaceLock
  clock: Clock
}

export interface StartBatchOptions {
  autoApply: boolean
}

export class BatchService {
  private readonly stopRequested = new Set<WorkspaceId>()

  constructor(private readonly deps: BatchServiceDeps) {}

  async start(workspaceId: WorkspaceId, options: StartBatchOptions): Promise<BatchPlan> {
    return this.deps.workspaceLock.run(workspaceId, async () => {
      const workspace = await this.deps.workspaceService.findById(workspaceId)
      await this.assertNoActiveBatch(workspace)
      const mode = this.resolveMode(workspace)
      const now = this.deps.clock.now()
      const baselineTag = `batch-baseline-${tagSuffix(now)}`
      const initialUnits = mode === 'intent' ? await this.buildIntentUnits(workspace) : []
      if (mode === 'intent' && initialUnits.length === 0) {
        throw new ValidationError(
          `Workspace "${workspace.id}" has intent sources registered but no intent documents inside them.`,
        )
      }

      const plan = new BatchPlan({
        id: newBatchPlanId(now),
        workspaceId,
        createdAt: now,
        updatedAt: now,
        mode,
        status: 'idle',
        autoApply: options.autoApply,
        units: initialUnits,
      }).beginRun(now, baselineTag)

      await this.tagBaseline(workspace, baselineTag, now)
      await this.deps.batchPlanRepository.save(workspace, plan)
      this.publish(workspaceId, { type: 'batch.started', workspaceId, planId: plan.id, mode, at: now })

      // Fire-and-forget; callers poll via getStatus or subscribe to SSE.
      void this.runLoop(workspace, plan).catch(async (err: unknown) => {
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

  // Promote stale running plans to failed at boot so the UI never shows a frozen spinner from a previous crashed process.
  async reconcileAfterBoot(workspaceId: WorkspaceId): Promise<void> {
    const workspace = await this.deps.workspaceService.findById(workspaceId)
    const plan = await this.deps.batchPlanRepository.load(workspace)
    if (!plan)
      return
    if (plan.status !== 'running' && plan.status !== 'scanning')
      return
    if (plan.running && this.deps.skillRunner.isActive(plan.running.skillRunId))
      return
    const failed = plan.markFailed(this.deps.clock.now(), 'Batch was interrupted by a server restart.')
    await this.deps.batchPlanRepository.save(workspace, failed)
  }

  async resume(workspaceId: WorkspaceId): Promise<BatchPlan> {
    return this.deps.workspaceLock.run(workspaceId, async () => {
      const workspace = await this.deps.workspaceService.findById(workspaceId)
      const existing = await this.deps.batchPlanRepository.load(workspace)
      if (!existing)
        throw new ValidationError(`No batch plan to resume on workspace "${workspaceId}"`)
      const now = this.deps.clock.now()
      const resumed = existing.resumeRun(now)
      this.stopRequested.delete(workspaceId)
      await this.deps.batchPlanRepository.save(workspace, resumed)
      this.publish(workspaceId, {
        type: 'batch.started',
        workspaceId,
        planId: resumed.id,
        mode: resumed.mode,
        at: now,
      })
      void this.runLoop(workspace, resumed).catch(async (err: unknown) => {
        const failed = (await this.deps.batchPlanRepository.load(workspace))
          ?.markFailed(this.deps.clock.now(), errorMessage(err))
        if (failed)
          await this.deps.batchPlanRepository.save(workspace, failed)
        this.publish(workspaceId, {
          type: 'batch.failed',
          workspaceId,
          planId: resumed.id,
          error: errorMessage(err),
          at: this.deps.clock.now(),
        })
      })
      return resumed
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
    // Orphan runId (server restart between unit start and Stop): no subprocess to SIGTERM; mark the plan failed inline.
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

  // Move a terminal plan to `archived`. The Studio Batch page treats
  // archived the same as "no active plan" but keeps the report
  // browsable via the PreStart "previous batch" slot.
  async archive(workspaceId: WorkspaceId): Promise<BatchPlan> {
    return this.deps.workspaceLock.run(workspaceId, async () => {
      const workspace = await this.deps.workspaceService.findById(workspaceId)
      const existing = await this.deps.batchPlanRepository.load(workspace)
      if (!existing)
        throw new ValidationError(`No batch plan to archive on workspace "${workspaceId}"`)
      const archived = existing.archive(this.deps.clock.now())
      await this.deps.batchPlanRepository.save(workspace, archived)
      return archived
    })
  }

  private async runLoop(workspace: Workspace, initial: BatchPlan): Promise<void> {
    let plan = initial
    if (plan.mode === 'scan') {
      plan = await this.runScanPhase(workspace, plan)
      if (plan.status !== 'running')
        return
    }
    for (const unit of plan.units) {
      // Skip completed units so Resume only re-runs pending ones (failed → pending was done by resumeRun()).
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
      plan = await this.runUnit(workspace, plan, unit)
    }
    const now = this.deps.clock.now()
    plan = plan.markCompleted(now)
    await this.deps.batchPlanRepository.save(workspace, plan)
    this.publish(workspace.id, {
      type: 'batch.completed',
      workspaceId: workspace.id,
      planId: plan.id,
      at: now,
    })
  }

  private async runScanPhase(workspace: Workspace, _plan: BatchPlan): Promise<BatchPlan> {
    const runId = await this.deps.skillRunner.start(workspace, SCAN_SKILL_ID, '')
    await waitForCompletion(this.deps.skillRunner, runId)
    const updated = await this.deps.batchPlanRepository.load(workspace)
    if (!updated)
      throw new Error('batch-plan.json disappeared during scan')
    if (updated.units.length === 0) {
      const failed = updated.markFailed(this.deps.clock.now(), 'braid-scan produced no units')
      await this.deps.batchPlanRepository.save(workspace, failed)
      return failed
    }
    const promoted = updated.promoteToRunning(this.deps.clock.now(), updated.units)
    await this.deps.batchPlanRepository.save(workspace, promoted)
    return promoted
  }

  private async runUnit(workspace: Workspace, plan: BatchPlan, unit: PlanUnit): Promise<BatchPlan> {
    const startedAt = this.deps.clock.now()
    let running = plan
    try {
      // Snapshot the pre-run id sets so post-run additions can be attributed to this unit.
      const before = await this.snapshotIds(workspace.id)
      const runId = await this.deps.skillRunner.start(workspace, EXTRACT_SKILL_ID, unitArg(unit))
      running = plan.startUnit(startedAt, unit.id, { unitId: unit.id, skillRunId: runId })
      await this.deps.batchPlanRepository.save(workspace, running)
      this.publish(workspace.id, {
        type: 'batch.unit.started',
        workspaceId: workspace.id,
        planId: plan.id,
        unitId: unit.id,
        unitName: unit.name,
        at: startedAt,
      })

      // Apply mid-run instead of post-unit: extract validators can require prior proposals to be applied, which deadlocks a sweep.
      const alreadyApplied = new Set<ProposalId>()
      const unsubscribe = plan.autoApply
        ? this.streamApplyProposals(workspace.id, alreadyApplied)
        : () => {}

      try {
        await waitForCompletion(this.deps.skillRunner, runId)
      }
      finally {
        unsubscribe()
      }

      const output = await this.collectUnitOutput(workspace.id, before)
      if (plan.autoApply) {
        // Belt + braces: sweep anything the stream listener missed (publish race / unsubscribe ordering).
        const remaining = output.proposalIds.filter(id => !alreadyApplied.has(id))
        await this.autoApply(remaining)
      }

      const completedAt = this.deps.clock.now()
      const completed = running.completeUnit(completedAt, unit.id, output)
      await this.deps.batchPlanRepository.save(workspace, completed)
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
      const failed = running.failUnit(completedAt, unit.id, errorMessage(err))
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

  // Captures all statuses so stream-applied proposals still appear in the unit's after-vs-before set-difference.
  private async snapshotIds(workspaceId: WorkspaceId): Promise<{
    proposals: Set<ProposalId>
    clarify: Set<ClarifyTicketId>
  }> {
    const [proposals, clarify] = await Promise.all([
      this.deps.proposalRepository.list({ workspaceId }),
      this.deps.clarifyRepository.list({ workspaceId }),
    ])
    return {
      proposals: new Set(proposals.map(p => p.id)),
      clarify: new Set(clarify.map(c => c.id)),
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

  private streamApplyProposals(workspaceId: WorkspaceId, applied: Set<ProposalId>): () => void {
    if (!this.deps.eventBus)
      return () => {}
    return this.deps.eventBus.subscribe(workspaceId, (event) => {
      if (event.type !== 'proposal.created')
        return
      if (applied.has(event.proposalId))
        return
      applied.add(event.proposalId)
      // Fire-and-forget; HITLService's per-workspace lock sequences this behind the submit that emitted the event.
      void this.deps.hitlService.applyProposal(event.proposalId, BATCH_USER_ID).catch(() => {
        // Validation race or conflict; the post-unit sweep retries.
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
        // Skip on conflict (e.g. validation error against latest snapshot); the proposal stays pending.
      }
    }
  }

  private async assertNoActiveBatch(workspace: Workspace): Promise<void> {
    const existing = await this.deps.batchPlanRepository.load(workspace)
    if (existing && (existing.status === 'running' || existing.status === 'scanning')) {
      throw new ConflictError(
        `Workspace "${workspace.id}" already has an active batch (plan ${existing.id} status=${existing.status})`,
      )
    }
  }

  private resolveMode(workspace: Workspace): BatchInputMode {
    if (workspace.intentSources().length > 0)
      return 'intent'
    if (workspace.codeSources().length > 0)
      return 'scan'
    throw new ValidationError(
      `Workspace "${workspace.id}" has no intent or code sources to bootstrap from`,
    )
  }

  private async buildIntentUnits(workspace: Workspace): Promise<PlanUnit[]> {
    const items = await this.deps.intentLister(workspace)
    return items.map(item => ({
      id: newPlanUnitId(),
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

function unitArg(unit: PlanUnit): string {
  return unit.scopeHint ?? unit.name
}

function tagSuffix(now: Timestamp): string {
  return now.replace(/[:.]/g, '-')
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
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
