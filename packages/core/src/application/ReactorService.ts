import type {
  ReactorCheckpoint,
  ReactorCycle,
  ReactorUnit,
  SkillEvent,
  SkillId,
  SkillRunId,
  SourceDescriptor,
  SourceId,
  SourceSyncedEvent,
  Timestamp,
  WorkspaceEvent,
  WorkspaceId,
} from '@braidhq/schema'
import type { Clock } from '../domain/Clock.js'
import type { Logger } from '../domain/Logger.js'
import type { OntologyBatchBinding, OntologyPerUnitBinding } from '../domain/plugin/OntologyPlugin.js'
import type { PluginRegistry } from '../domain/plugin/PluginRegistry.js'
import type { ReactorCycleRepository } from '../domain/reactor/ReactorCycleRepository.js'
import type { ScheduledTask, Scheduler } from '../domain/Scheduler.js'
import type { SkillRunner } from '../domain/skill/SkillRunner.js'
import type { SourceUnitDigest } from '../domain/source/SourceUnitDigest.js'
import type { Workspace } from '../domain/workspace/Workspace.js'
import type { IntentLister } from './BatchService.js'
import type { SourceUnitObservationService } from './SourceUnitObservationService.js'
import type { WorkspaceEventBus } from './WorkspaceEventBus.js'
import type { WorkspaceLock } from './WorkspaceLock.js'
import type { WorkspaceService } from './WorkspaceService.js'
import { newReactorCycleId } from '../domain/ids.js'
import { computeSourceDiff } from './computeSourceDiff.js'

export interface ReactorServiceDeps {
  readonly eventBus: WorkspaceEventBus
  readonly workspaceService: WorkspaceService
  readonly pluginRegistry: PluginRegistry
  readonly skillRunner: SkillRunner
  readonly sourceUnitObservationService: SourceUnitObservationService
  readonly intentLister: IntentLister
  readonly digest: SourceUnitDigest
  readonly reactorCycleRepository: ReactorCycleRepository
  readonly clock: Clock
  /**
   * Required. Two `source.synced` events for one workspace arriving at once,
   * must not both bypass the throttle.
   * The lock serialises cycle execution per workspace.
   * Sharing the HITLService or HistoryService lock instance is fine,
   * the reactor holds its own critical section and never blocks writes.
   */
  readonly workspaceLock: WorkspaceLock
  readonly logger: Logger
  readonly scheduler: Scheduler
}

const HOUR_MS = 60 * 60 * 1000
const DEFAULT_MAX_RUNS_PER_HOUR = 5

/**
 * Rolling 1h sliding-window counter of reactor dispatches.
 * Wraps the "is this workspace over its cap right now" question,
 * and the clock-based pruning that goes with it,
 * so the service code does not mix a predicate with a mutating side effect.
 */
class ThrottleWindow {
  private readonly timestamps: number[] = []
  constructor(private readonly clock: Clock, readonly limit: number) {}

  isOverLimit(): boolean {
    this.prune()
    return this.timestamps.length >= this.limit
  }

  recordDispatch(): void {
    this.prune()
    this.timestamps.push(Date.parse(this.clock.now()))
  }

  // Milliseconds until the oldest dispatch ages out and frees one slot.
  // Zero when already under the limit.
  msUntilSlotFrees(): number {
    this.prune()
    if (this.timestamps.length < this.limit)
      return 0
    return this.timestamps[0]! + HOUR_MS - Date.parse(this.clock.now())
  }

  private prune(): void {
    const cutoff = Date.parse(this.clock.now()) - HOUR_MS
    let firstFresh = 0
    while (firstFresh < this.timestamps.length && this.timestamps[firstFresh]! < cutoff)
      firstFresh++
    if (firstFresh > 0)
      this.timestamps.splice(0, firstFresh)
  }
}

/**
 * Per-cycle context the orchestrator threads through its substeps.
 * The `cycle` field is the authoritative state,
 * each step reassigns it to a new immutable snapshot,
 * and `persistAndEmit()` saves the latest so the Activity page stays live.
 */
interface CycleContext {
  readonly workspace: Workspace
  readonly sourceId: SourceId
  readonly batchBinding: OntologyBatchBinding
  cycle: ReactorCycle
}

/**
 * Reactor implementation.
 * Listens to `source.synced` on the `WorkspaceEventBus`, and for intent-role sources,
 * runs the active ontology's per-unit skill against the diff,
 * between the current units on disk and the recorded `SourceUnitObservation` ledger.
 * After all per-unit dispatches settle,
 * runs one ontology checkpoint when at least one per-unit succeeded.
 *
 * Two outputs per cycle. A `ReactorCycle` record persisted via `ReactorCycleRepository`,
 * queryable via REST and the Studio Activity page.
 * A stream of SSE events on the workspace bus the page subscribes to for live updates.
 * The two surfaces agree by construction, every event corresponds to a save.
 *
 * Locked decisions.
 * - Per-unit dispatch, not batched, and sequential with no concurrency.
 * - Intent-role only, `role: 'code'` sources fall through.
 * - First-provision does NOT fire the reactor,
 *   the operator runs `cmd.runBatch` for the initial corpus.
 * - Throttle on a rolling 1h window per workspace,
 *   the (N+1)th dispatch emits `reactor.throttled` and drops.
 * - No gate assumption, emits `reactor.completed` and stops,
 *   apply stays with upstream layers.
 */
export class ReactorService {
  private readonly subscriptions = new Map<WorkspaceId, () => void>()
  private readonly throttles = new Map<WorkspaceId, ThrottleWindow>()
  // Keyed by `${workspaceId}:${sourceId}`. One pending catch-up per throttled source.
  private readonly retries = new Map<string, ScheduledTask>()

  constructor(private readonly deps: ReactorServiceDeps) {}

  async start(workspaceId: WorkspaceId): Promise<void> {
    if (this.subscriptions.has(workspaceId))
      return
    const workspace = await this.deps.workspaceService.findById(workspaceId)
    const limit = workspace.productManifest.reactor?.maxRunsPerHour ?? DEFAULT_MAX_RUNS_PER_HOUR
    this.throttles.set(workspaceId, new ThrottleWindow(this.deps.clock, limit))
    const unsubscribe = this.deps.eventBus.subscribe(workspaceId, (event) => {
      if (event.type === 'source.synced')
        void this.handleSourceSynced(event)
    })
    this.subscriptions.set(workspaceId, unsubscribe)
  }

  async stop(workspaceId: WorkspaceId): Promise<void> {
    const unsub = this.subscriptions.get(workspaceId)
    if (!unsub)
      return
    unsub()
    this.subscriptions.delete(workspaceId)
    this.throttles.delete(workspaceId)
    for (const [key, task] of this.retries) {
      if (key.startsWith(`${workspaceId}:`)) {
        task.cancel()
        this.retries.delete(key)
      }
    }
  }

  /**
   * Entry point for every qualifying delivery.
   * Serialised per workspace via `workspaceLock`,
   * so two events arriving in the same tick cannot both bypass the throttle,
   * and so a sync arriving while a previous cycle is mid-flight waits its turn,
   * rather than interleaving per-unit dispatches.
   */
  private async handleSourceSynced(event: SourceSyncedEvent): Promise<void> {
    try {
      await this.deps.workspaceLock.run(event.workspaceId, () => this.runCycle(event))
    }
    catch (err) {
      this.deps.logger.error(
        {
          workspaceId: event.workspaceId,
          sourceId: event.sourceId,
          err: err instanceof Error ? err.message : String(err),
        },
        'reactor: cycle failed',
      )
    }
  }

  private async runCycle(event: SourceSyncedEvent): Promise<void> {
    const resolved = await this.prepareCycle(event)
    if (!resolved)
      return
    const changedPaths = await this.changedUnitPaths(resolved)
    if (changedPaths.length === 0) {
      // No-op cycle. Still persist and emit,
      // so the Activity page records every delivered event consistently,
      // and the operator can see the reactor ran but had nothing to do.
      await this.recordCompleted(resolved, 0, false)
      return
    }
    const throttle = this.throttleFor(resolved.workspace.id)
    if (throttle.isOverLimit()) {
      await this.recordThrottled(resolved)
      this.scheduleRetry(resolved, throttle.msUntilSlotFrees())
      return
    }
    throttle.recordDispatch()
    resolved.cycle = startRunning(resolved.cycle, changedPaths.map(makeQueuedUnit))
    await this.persistAndEmit(resolved, this.dispatchedEvent(resolved, changedPaths.length))
    const checkpointRan = await this.dispatchUnitsThenCheckpoint(resolved)
    await this.recordCompleted(resolved, changedPaths.length, checkpointRan)
  }

  private async prepareCycle(event: SourceSyncedEvent): Promise<CycleContext | undefined> {
    const workspace = await this.deps.workspaceService.findById(event.workspaceId)
    const source = workspace.sources.find(candidate => candidate.id === event.sourceId)
    if (!isIntentSource(source))
      return undefined
    const ontology = this.deps.pluginRegistry.findOntology(workspace.productManifest.ontologyId)
    const batchBinding = ontology?.batch
    if (!batchBinding?.perUnit?.skillId)
      return undefined
    const startedAt = this.deps.clock.now()
    const cycle: ReactorCycle = {
      id: newReactorCycleId(),
      workspaceId: workspace.id,
      sourceId: event.sourceId,
      startedAt,
      status: 'dispatched',
      units: [],
    }
    return { workspace, sourceId: event.sourceId, batchBinding, cycle }
  }

  private async changedUnitPaths(context: CycleContext): Promise<readonly string[]> {
    const diff = await computeSourceDiff(this.deps, context.workspace, context.sourceId)
    return [...diff.new, ...diff.changed].map(unit => unit.path)
  }

  /**
   * Sequentially dispatch the per-unit skill against each queued unit,
   * then dispatch the checkpoint skill iff at least one per-unit succeeded.
   * A per-unit failure does NOT abort the loop,
   * the failed unit stays out of the ledger so the next sync retries it.
   */
  private async dispatchUnitsThenCheckpoint(context: CycleContext): Promise<boolean> {
    let anySucceeded = false
    for (let i = 0; i < context.cycle.units.length; i++) {
      const ok = await this.dispatchUnit(context, i)
      anySucceeded = anySucceeded || ok
    }
    const checkpointSkillId = context.batchBinding.checkpoint?.skillId
    if (anySucceeded && checkpointSkillId)
      return this.dispatchCheckpoint(context, checkpointSkillId)
    // No per-unit succeeded, or no checkpoint configured,
    // so there is no checkpoint run to report.
    // The terminal `reactor.completed` event carries `checkpointRan: false`.
    // No separate `checkpoint.completed` event is emitted,
    // keeping persisted state and event stream in sync.
    return false
  }

  private async dispatchUnit(context: CycleContext, index: number): Promise<boolean> {
    const { workspace, sourceId, batchBinding, cycle } = context
    const path = cycle.units[index]!.path
    const total = cycle.units.length
    let runId: SkillRunId
    try {
      const args = argsForPath(batchBinding.perUnit, path)
      runId = await this.deps.skillRunner.start(workspace, batchBinding.perUnit.skillId, args)
      context.cycle = updateUnit(cycle, index, { status: 'running', skillRunId: runId, startedAt: this.deps.clock.now() })
      await this.persistAndEmit(context, this.unitStartedEvent(context, index, runId, total))
      await waitForCompletion(this.deps.skillRunner, runId)
    }
    catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.deps.logger.warn(
        { workspaceId: workspace.id, sourceId, path, err: message },
        'reactor: per-unit dispatch failed; continuing to next unit',
      )
      context.cycle = updateUnit(context.cycle, index, {
        status: 'failure',
        completedAt: this.deps.clock.now(),
        error: message,
      })
      await this.persistAndEmit(context, this.unitCompletedEvent(context, index, 'failure', total))
      return false
    }
    // The skill ran cleanly.
    // Recording the observation and persisting success are best-effort.
    // If either fails, the unit is still semantically successful,
    // its side effects already happened.
    // Marking it a failure here would cause a duplicate dispatch next sync,
    // since the ledger may already hold the new sha, silently re-running the skill.
    try {
      await this.deps.sourceUnitObservationService.recordObservation(workspace.id, sourceId, path, runId)
    }
    catch (err) {
      this.deps.logger.warn(
        { workspaceId: workspace.id, sourceId, path, err: err instanceof Error ? err.message : String(err) },
        'reactor: skill succeeded but recordObservation failed; unit remains success',
      )
    }
    context.cycle = updateUnit(context.cycle, index, { status: 'success', completedAt: this.deps.clock.now() })
    await this.persistAndEmit(context, this.unitCompletedEvent(context, index, 'success', total))
    return true
  }

  private async dispatchCheckpoint(context: CycleContext, skillId: SkillId): Promise<boolean> {
    const { workspace } = context
    const startedAt = this.deps.clock.now()
    try {
      const runId = await this.deps.skillRunner.start(workspace, skillId, '')
      context.cycle = updateCheckpoint(context.cycle, { skillId, status: 'running', skillRunId: runId, startedAt })
      await this.persistAndEmit(context, this.checkpointStartedEvent(context, skillId, runId))
      await waitForCompletion(this.deps.skillRunner, runId)
      context.cycle = updateCheckpoint(context.cycle, {
        ...context.cycle.checkpoint!,
        status: 'success',
        completedAt: this.deps.clock.now(),
      })
      await this.persistAndEmit(context, this.checkpointCompletedEvent(context, 'success'))
      return true
    }
    catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.deps.logger.warn({ workspaceId: workspace.id, skillId, err: message }, 'reactor: checkpoint dispatch failed')
      context.cycle = updateCheckpoint(context.cycle, {
        skillId,
        status: 'failure',
        startedAt,
        completedAt: this.deps.clock.now(),
        error: message,
      })
      await this.persistAndEmit(context, this.checkpointCompletedEvent(context, 'failure'))
      return false
    }
  }

  /** Persist the completed cycle and emit its terminal event. */
  private async recordCompleted(
    context: CycleContext,
    totalUnits: number,
    checkpointRan: boolean,
  ): Promise<void> {
    context.cycle = { ...context.cycle, status: 'completed', completedAt: this.deps.clock.now() }
    await this.persistAndEmit(context, this.completedEvent(context, totalUnits, checkpointRan))
  }

  private async recordThrottled(context: CycleContext): Promise<void> {
    const limit = this.throttleFor(context.workspace.id).limit
    context.cycle = {
      ...context.cycle,
      status: 'throttled',
      completedAt: this.deps.clock.now(),
      throttledReason: `maxRunsPerHour=${limit}`,
    }
    await this.persistAndEmit(context, this.throttledEvent(context, limit))
  }

  private throttleFor(workspaceId: WorkspaceId): ThrottleWindow {
    const window = this.throttles.get(workspaceId)
    if (!window)
      throw new Error(`reactor: throttle not initialised for workspace "${workspaceId}"; was start() called?`)
    return window
  }

  // A throttled cycle drops its delivery, so schedule one catch-up when a slot frees.
  // It re-enters the locked path, re-derives the diff, and re-checks the throttle,
  // so it no-ops if the changes were already handled, or reschedules if still full.
  // At most one pending catch-up per source.
  private scheduleRetry(context: CycleContext, delayMs: number): void {
    const key = `${context.workspace.id}:${context.sourceId}`
    if (this.retries.has(key))
      return
    const task = this.deps.scheduler.schedule(delayMs, () => {
      this.retries.delete(key)
      void this.handleSourceSynced({
        type: 'source.synced',
        workspaceId: context.workspace.id,
        sourceId: context.sourceId,
        changed: true,
        at: this.deps.clock.now(),
      })
    })
    this.retries.set(key, task)
  }

  private async persistAndEmit(context: CycleContext, event: WorkspaceEvent): Promise<void> {
    await this.deps.reactorCycleRepository.save(context.cycle)
    this.deps.eventBus.publish(event)
  }

  private dispatchedEvent(context: CycleContext, totalUnits: number): WorkspaceEvent {
    return {
      type: 'reactor.dispatched',
      workspaceId: context.workspace.id,
      cycleId: context.cycle.id,
      sourceId: context.sourceId,
      totalUnits,
      at: this.deps.clock.now(),
    }
  }

  private completedEvent(context: CycleContext, totalUnits: number, checkpointRan: boolean): WorkspaceEvent {
    return {
      type: 'reactor.completed',
      workspaceId: context.workspace.id,
      cycleId: context.cycle.id,
      sourceId: context.sourceId,
      totalUnits,
      checkpointRan,
      at: this.deps.clock.now(),
    }
  }

  private throttledEvent(context: CycleContext, limit: number): WorkspaceEvent {
    return {
      type: 'reactor.throttled',
      workspaceId: context.workspace.id,
      cycleId: context.cycle.id,
      sourceId: context.sourceId,
      limit,
      at: this.deps.clock.now(),
    }
  }

  private unitStartedEvent(context: CycleContext, index: number, skillRunId: SkillRunId, total: number): WorkspaceEvent {
    return {
      type: 'reactor.unit.started',
      workspaceId: context.workspace.id,
      cycleId: context.cycle.id,
      unitPath: context.cycle.units[index]!.path,
      skillRunId,
      processed: index,
      total,
      at: this.deps.clock.now(),
    }
  }

  private unitCompletedEvent(context: CycleContext, index: number, status: 'success' | 'failure', total: number): WorkspaceEvent {
    return {
      type: 'reactor.unit.completed',
      workspaceId: context.workspace.id,
      cycleId: context.cycle.id,
      unitPath: context.cycle.units[index]!.path,
      status,
      processed: index + 1,
      total,
      at: this.deps.clock.now(),
    }
  }

  private checkpointStartedEvent(context: CycleContext, skillId: SkillId, skillRunId: SkillRunId): WorkspaceEvent {
    return {
      type: 'reactor.checkpoint.started',
      workspaceId: context.workspace.id,
      cycleId: context.cycle.id,
      skillId,
      skillRunId,
      at: this.deps.clock.now(),
    }
  }

  private checkpointCompletedEvent(context: CycleContext, status: 'success' | 'failure' | 'skipped'): WorkspaceEvent {
    return {
      type: 'reactor.checkpoint.completed',
      workspaceId: context.workspace.id,
      cycleId: context.cycle.id,
      status,
      at: this.deps.clock.now(),
    }
  }
}

function makeQueuedUnit(path: string): ReactorUnit {
  return { path, status: 'queued' }
}

function startRunning(cycle: ReactorCycle, units: readonly ReactorUnit[]): ReactorCycle {
  return { ...cycle, units: [...units], status: 'running' }
}

function updateUnit(cycle: ReactorCycle, index: number, patch: Partial<ReactorUnit>): ReactorCycle {
  const units = cycle.units.slice()
  units[index] = { ...units[index]!, ...patch }
  return { ...cycle, units }
}

function updateCheckpoint(cycle: ReactorCycle, checkpoint: ReactorCheckpoint): ReactorCycle {
  return { ...cycle, checkpoint }
}

function isIntentSource(source: SourceDescriptor | undefined): source is SourceDescriptor & { role: 'intent' } {
  return source?.role === 'intent'
}

/**
 * Compute the per-unit skill args for a path.
 * The ontology's `argsFor` is typed against `BatchUnit`, BatchService's domain,
 * but it only reads `name` and `scopeHint`,
 * so we honour that contract by passing a minimal synthetic.
 * Keeping the cast in one helper leaves the rest of the reactor free of casts.
 */
function argsForPath(binding: OntologyPerUnitBinding, path: string): string {
  if (!binding.argsFor)
    return path
  const synthetic = { name: path, scopeHint: path } as unknown as Parameters<NonNullable<OntologyPerUnitBinding['argsFor']>>[0]
  return binding.argsFor(synthetic)
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

// Re-export Timestamp shape so type-only consumers don't have to dig.
export type { Timestamp }
