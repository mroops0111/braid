import type {
  ReactorCheckpoint,
  ReactorCycle,
  ReactorUnit,
  SkillEvent,
  SkillId,
  SkillRunId,
  SourceDescriptor,
  SourceId,
  Timestamp,
  WorkspaceId,
} from '@braidhq/schema'
import type { Clock } from '../domain/Clock.js'
import type { SourceSyncedEvent, WorkspaceEvent } from '../domain/events/WorkspaceEvent.js'
import type { OntologyBatchBinding, OntologyPerUnitBinding } from '../domain/plugin/Ontology.js'
import type { PluginRegistry } from '../domain/plugin/PluginRegistry.js'
import type { Reactor } from '../domain/reactor/Reactor.js'
import type { ReactorCycleRepository } from '../domain/reactor/ReactorCycleRepository.js'
import type { SkillRunner } from '../domain/skill/SkillRunner.js'
import type { SourceUnitDigest } from '../domain/source/SourceUnitDigest.js'
import type { Workspace } from '../domain/workspace/Workspace.js'
import type { IntentLister } from './BatchService.js'
import type { PerWorkspaceLock } from './PerWorkspaceLock.js'
import type { SourceUnitObservationService } from './SourceUnitObservationService.js'
import type { WorkspaceEventBus } from './WorkspaceEventBus.js'
import type { WorkspaceService } from './WorkspaceService.js'
import { newReactorCycleId } from '../domain/ids.js'
import { createLogger } from '../infrastructure/logger.js'
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
   * Required. Two `source.synced` events for the same workspace
   * arriving simultaneously must not both bypass the throttle — the
   * lock serialises pass execution per workspace. The same lock
   * instance HITLService / HistoryService use is fine; the reactor
   * holds its own critical section so it does not block their writes.
   */
  readonly workspaceLock: PerWorkspaceLock
}

const reactorLogger = createLogger('reactor')

const HOUR_MS = 60 * 60 * 1000
const DEFAULT_MAX_RUNS_PER_HOUR = 5

/**
 * Rolling 1h sliding-window counter of reactor dispatches. Encapsulates
 * the "is this workspace over its cap right now" question and the
 * accompanying clock-based pruning so the service code does not mix a
 * predicate with a mutating side effect.
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
 * Per-pass context the orchestrator threads through its substeps. The
 * `pass` reference is the authoritative state object — every helper
 * mutates it through small `update*` methods and `persist()` saves the
 * latest snapshot so Studio's Activity page can render the live pass
 * without re-deriving anything.
 */
interface PassContext {
  readonly workspace: Workspace
  readonly sourceId: SourceId
  readonly batchBinding: OntologyBatchBinding
  pass: ReactorCycle
}

/**
 * Reactor implementation. Listens to `source.synced` events on the
 * `WorkspaceEventBus` and, for intent-role sources, runs the active
 * ontology's per-unit skill against the diff between current units on
 * disk and the recorded `SourceUnitObservation` ledger. After all per-unit
 * dispatches settle, runs one ontology checkpoint pass when at least
 * one per-unit succeeded.
 *
 * Two outputs per pass: a `ReactorCycle` record persisted via
 * `ReactorCycleRepository` (queryable via REST + the Studio Activity
 * page), and a stream of SSE events on the workspace bus the page
 * subscribes to for live updates. The two surfaces agree by
 * construction — every event corresponds to a save.
 *
 * Locked decisions (per #29):
 *   - per-unit dispatch (not batched), sequential (no concurrency)
 *   - intent-role only; `role: 'code'` sources fall through
 *   - first-ingest does NOT fire reactor; the operator runs
 *     `cmd.runBatch` for the initial corpus
 *   - throttle: rolling 1h window per workspace; the (N+1)th dispatch
 *     emits `reactor.throttled` and drops
 *   - no gate assumption: emits `reactor.completed` and stops; apply
 *     stays with upstream layers
 */
export class ReactorService implements Reactor {
  private readonly subscriptions = new Map<WorkspaceId, () => void>()
  private readonly throttles = new Map<WorkspaceId, ThrottleWindow>()

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
  }

  /**
   * Entry point for every qualifying delivery. Serialised per workspace
   * via `workspaceLock` so two events arriving in the same tick cannot
   * both bypass the throttle, and so a sync arriving while a previous
   * pass is mid-flight waits its turn rather than interleaving
   * per-unit dispatches.
   */
  private async handleSourceSynced(event: SourceSyncedEvent): Promise<void> {
    try {
      await this.deps.workspaceLock.run(event.workspaceId, () => this.runPassFor(event))
    }
    catch (err) {
      reactorLogger.error(
        {
          workspaceId: event.workspaceId,
          sourceId: event.sourceId,
          err: err instanceof Error ? err.message : String(err),
        },
        'reactor: pass failed',
      )
    }
  }

  private async runPassFor(event: SourceSyncedEvent): Promise<void> {
    const resolved = await this.resolveContext(event)
    if (!resolved)
      return
    const changedPaths = await this.changedPathsForPass(resolved)
    if (changedPaths.length === 0) {
      // No-op pass: still persist + emit so the Activity page records
      // every delivered event consistently and the operator can see
      // "reactor ran but had nothing to do".
      await this.recordTerminal(resolved, 'completed', 0, false)
      return
    }
    const throttle = this.throttleFor(resolved.workspace.id)
    if (throttle.isOverLimit()) {
      await this.recordThrottled(resolved)
      return
    }
    throttle.recordDispatch()
    resolved.pass = withUnits(resolved.pass, changedPaths.map(makeQueuedUnit))
    await this.persistAndEmit(resolved, this.dispatched(resolved, changedPaths.length))
    const checkpointRan = await this.runDispatchLoop(resolved)
    await this.recordTerminal(resolved, 'completed', changedPaths.length, checkpointRan)
  }

  private async resolveContext(event: SourceSyncedEvent): Promise<PassContext | undefined> {
    const workspace = await this.deps.workspaceService.findById(event.workspaceId)
    const source = workspace.sources.find(s => s.id === event.sourceId)
    if (!isIntentSource(source))
      return undefined
    const ontology = this.deps.pluginRegistry.findOntology(workspace.productManifest.ontologyId)
    const batchBinding = ontology?.batch
    if (!batchBinding?.perUnit?.skillId)
      return undefined
    const startedAt = this.deps.clock.now()
    const pass: ReactorCycle = {
      id: newReactorCycleId(startedAt),
      workspaceId: workspace.id,
      sourceId: event.sourceId,
      startedAt,
      status: 'dispatched',
      units: [],
    }
    return { workspace, sourceId: event.sourceId, batchBinding, pass }
  }

  private async changedPathsForPass(context: PassContext): Promise<readonly string[]> {
    const diff = await computeSourceDiff(this.deps, context.workspace, context.sourceId)
    return [...diff.new, ...diff.changed].map(u => u.path)
  }

  /**
   * Sequentially dispatch the per-unit skill against each queued unit
   * then, iff at least one per-unit succeeded, dispatch the checkpoint
   * skill. A per-unit failure does NOT abort the loop; the failed
   * unit stays out of the ledger so the next sync retries it.
   */
  private async runDispatchLoop(context: PassContext): Promise<boolean> {
    let anySucceeded = false
    for (let i = 0; i < context.pass.units.length; i++) {
      const ok = await this.dispatchPerUnit(context, i)
      anySucceeded = anySucceeded || ok
    }
    const checkpointSkillId = context.batchBinding.checkpoint?.skillId
    if (anySucceeded && checkpointSkillId)
      return this.dispatchCheckpoint(context, checkpointSkillId)
    // No per-unit succeeded (or no checkpoint configured) — there is no
    // checkpoint pass to report. The terminal `reactor.completed` event
    // carries `checkpointRan: false`; no separate `checkpoint.completed`
    // event is emitted, keeping persisted state and event stream in sync.
    return false
  }

  private async dispatchPerUnit(context: PassContext, index: number): Promise<boolean> {
    const { workspace, sourceId, batchBinding, pass } = context
    const path = pass.units[index]!.path
    const total = pass.units.length
    let runId: SkillRunId
    try {
      const args = argsForPath(batchBinding.perUnit, path)
      runId = await this.deps.skillRunner.start(workspace, batchBinding.perUnit.skillId, args)
      context.pass = updateUnit(pass, index, { status: 'running', skillRunId: runId, startedAt: this.deps.clock.now() })
      await this.persistAndEmit(context, this.unitStarted(context, index, runId, total))
      await waitForCompletion(this.deps.skillRunner, runId)
    }
    catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      reactorLogger.warn(
        { workspaceId: workspace.id, sourceId, path, err: message },
        'reactor: per-unit dispatch failed; continuing to next unit',
      )
      context.pass = updateUnit(context.pass, index, {
        status: 'failure',
        completedAt: this.deps.clock.now(),
        error: message,
      })
      await this.persistAndEmit(context, this.unitCompleted(context, index, 'failure', total))
      return false
    }
    // The skill ran cleanly. Recording the observation and persisting the
    // success state are best-effort follow-ups: if either fails, the unit
    // is still semantically successful (the skill's side effects have
    // already happened). Marking it as failure here would cause a
    // duplicate dispatch on the next sync since the ledger may already
    // have the new sha, which would silently re-run the skill.
    try {
      await this.deps.sourceUnitObservationService.recordObservation(workspace.id, sourceId, path, runId)
    }
    catch (err) {
      reactorLogger.warn(
        { workspaceId: workspace.id, sourceId, path, err: err instanceof Error ? err.message : String(err) },
        'reactor: skill succeeded but recordObservation failed; unit remains success',
      )
    }
    context.pass = updateUnit(context.pass, index, { status: 'success', completedAt: this.deps.clock.now() })
    await this.persistAndEmit(context, this.unitCompleted(context, index, 'success', total))
    return true
  }

  private async dispatchCheckpoint(context: PassContext, skillId: SkillId): Promise<boolean> {
    const { workspace } = context
    const startedAt = this.deps.clock.now()
    try {
      const runId = await this.deps.skillRunner.start(workspace, skillId, '')
      context.pass = withCheckpoint(context.pass, { skillId, status: 'running', skillRunId: runId, startedAt })
      await this.persistAndEmit(context, this.checkpointStarted(context, skillId, runId))
      await waitForCompletion(this.deps.skillRunner, runId)
      context.pass = withCheckpoint(context.pass, {
        ...context.pass.checkpoint!,
        status: 'success',
        completedAt: this.deps.clock.now(),
      })
      await this.persistAndEmit(context, this.checkpointCompleted(context, 'success'))
      return true
    }
    catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      reactorLogger.warn({ workspaceId: workspace.id, skillId, err: message }, 'reactor: checkpoint dispatch failed')
      context.pass = withCheckpoint(context.pass, {
        skillId,
        status: 'failure',
        startedAt,
        completedAt: this.deps.clock.now(),
        error: message,
      })
      await this.persistAndEmit(context, this.checkpointCompleted(context, 'failure'))
      return false
    }
  }

  /** Persist final pass state + emit terminal event. */
  private async recordTerminal(
    context: PassContext,
    status: 'completed',
    totalUnits: number,
    checkpointRan: boolean,
  ): Promise<void> {
    context.pass = { ...context.pass, status, completedAt: this.deps.clock.now() }
    await this.persistAndEmit(context, this.completed(context, totalUnits, checkpointRan))
  }

  private async recordThrottled(context: PassContext): Promise<void> {
    const limit = this.throttleFor(context.workspace.id).limit
    context.pass = {
      ...context.pass,
      status: 'throttled',
      completedAt: this.deps.clock.now(),
      throttledReason: `maxRunsPerHour=${limit}`,
    }
    await this.persistAndEmit(context, this.throttled(context, limit))
  }

  private throttleFor(workspaceId: WorkspaceId): ThrottleWindow {
    const window = this.throttles.get(workspaceId)
    if (!window)
      throw new Error(`reactor: throttle not initialised for workspace "${workspaceId}"; was start() called?`)
    return window
  }

  private async persistAndEmit(context: PassContext, event: WorkspaceEvent): Promise<void> {
    await this.deps.reactorCycleRepository.save(context.pass)
    this.deps.eventBus.publish(event)
  }

  // === event builders ====================================================

  private dispatched(context: PassContext, totalUnits: number): WorkspaceEvent {
    return {
      type: 'reactor.dispatched',
      workspaceId: context.workspace.id,
      passId: context.pass.id,
      sourceId: context.sourceId,
      totalUnits,
      at: this.deps.clock.now(),
    }
  }

  private completed(context: PassContext, totalUnits: number, checkpointRan: boolean): WorkspaceEvent {
    return {
      type: 'reactor.completed',
      workspaceId: context.workspace.id,
      passId: context.pass.id,
      sourceId: context.sourceId,
      totalUnits,
      checkpointRan,
      at: this.deps.clock.now(),
    }
  }

  private throttled(context: PassContext, limit: number): WorkspaceEvent {
    return {
      type: 'reactor.throttled',
      workspaceId: context.workspace.id,
      passId: context.pass.id,
      sourceId: context.sourceId,
      limit,
      at: this.deps.clock.now(),
    }
  }

  private unitStarted(context: PassContext, index: number, skillRunId: SkillRunId, total: number): WorkspaceEvent {
    return {
      type: 'reactor.unit.started',
      workspaceId: context.workspace.id,
      passId: context.pass.id,
      unitPath: context.pass.units[index]!.path,
      skillRunId,
      processed: index,
      total,
      at: this.deps.clock.now(),
    }
  }

  private unitCompleted(context: PassContext, index: number, status: 'success' | 'failure', total: number): WorkspaceEvent {
    return {
      type: 'reactor.unit.completed',
      workspaceId: context.workspace.id,
      passId: context.pass.id,
      unitPath: context.pass.units[index]!.path,
      status,
      processed: index + 1,
      total,
      at: this.deps.clock.now(),
    }
  }

  private checkpointStarted(context: PassContext, skillId: SkillId, skillRunId: SkillRunId): WorkspaceEvent {
    return {
      type: 'reactor.checkpoint.started',
      workspaceId: context.workspace.id,
      passId: context.pass.id,
      skillId,
      skillRunId,
      at: this.deps.clock.now(),
    }
  }

  private checkpointCompleted(context: PassContext, status: 'success' | 'failure' | 'skipped'): WorkspaceEvent {
    return {
      type: 'reactor.checkpoint.completed',
      workspaceId: context.workspace.id,
      passId: context.pass.id,
      status,
      at: this.deps.clock.now(),
    }
  }
}

// === ReactorCycle mutation helpers =========================================

function makeQueuedUnit(path: string): ReactorUnit {
  return { path, status: 'queued' }
}

function withUnits(pass: ReactorCycle, units: readonly ReactorUnit[]): ReactorCycle {
  return { ...pass, units: [...units], status: 'running' }
}

function updateUnit(pass: ReactorCycle, index: number, patch: Partial<ReactorUnit>): ReactorCycle {
  const units = pass.units.slice()
  units[index] = { ...units[index]!, ...patch }
  return { ...pass, units }
}

function withCheckpoint(pass: ReactorCycle, checkpoint: ReactorCheckpoint): ReactorCycle {
  return { ...pass, checkpoint }
}

function isIntentSource(source: SourceDescriptor | undefined): source is SourceDescriptor & { role: 'intent' } {
  return source?.role === 'intent'
}

/**
 * Compute the per-unit skill args for a path. The ontology's `argsFor`
 * is typed against `PlanUnit` (BatchService's domain), but it only
 * reads `name` + `scopeHint`; we honour that contract by passing a
 * minimal synthetic. Keeping the cast in one helper means the rest of
 * the reactor stays free of `as unknown as` casts.
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
