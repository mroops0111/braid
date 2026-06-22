import type { SkillEvent, SkillId, SkillRunId, SourceDescriptor, SourceId, WorkspaceId } from '@braidhq/schema'
import type { Clock } from '../domain/Clock.js'
import type { SourceSyncedEvent, WorkspaceEvent } from '../domain/events/WorkspaceEvent.js'
import type { OntologyBatchBinding, OntologyPerUnitBinding } from '../domain/plugin/Ontology.js'
import type { PluginRegistry } from '../domain/plugin/PluginRegistry.js'
import type { Reactor } from '../domain/reactor/Reactor.js'
import type { SkillRunner } from '../domain/skill/SkillRunner.js'
import type { SourceUnitDigest } from '../domain/source/SourceUnitDigest.js'
import type { Workspace } from '../domain/workspace/Workspace.js'
import type { IntentLister } from './BatchService.js'
import type { PerWorkspaceLock } from './PerWorkspaceLock.js'
import type { SourceUnitStateService } from './SourceUnitStateService.js'
import type { WorkspaceEventBus } from './WorkspaceEventBus.js'
import type { WorkspaceService } from './WorkspaceService.js'
import { createLogger } from '../infrastructure/logger.js'
import { computeSourceDiff } from './computeSourceDiff.js'

export interface ReactorServiceDeps {
  readonly eventBus: WorkspaceEventBus
  readonly workspaceService: WorkspaceService
  readonly pluginRegistry: PluginRegistry
  readonly skillRunner: SkillRunner
  readonly sourceUnitStateService: SourceUnitStateService
  readonly intentLister: IntentLister
  readonly digest: SourceUnitDigest
  readonly clock: Clock
  /**
   * Required. Two `source.synced` events for the same workspace
   * arriving simultaneously must not both pass the throttle check —
   * the lock serialises pass execution per workspace. The same lock
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
 * accompanying clock-based pruning so the service code does not mix
 * a predicate with a mutating side effect.
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
 * Per-pass context the orchestrator threads through its substeps. Avoids
 * a long parameter list and makes the dispatch loop easier to read.
 */
interface PassContext {
  readonly workspace: Workspace
  readonly sourceId: SourceId
  readonly batchBinding: OntologyBatchBinding
}

/**
 * Reactor implementation. Listens to `source.synced` events on the
 * `WorkspaceEventBus` and, for intent-role sources, runs the active
 * ontology's per-unit skill against the diff between current units on
 * disk and the recorded `SourceUnitState` ledger. After all per-unit
 * dispatches settle, runs one ontology checkpoint pass when at least
 * one per-unit succeeded.
 *
 * Locked decisions (per #29):
 *   - per-unit dispatch (not batched), sequential (no concurrency)
 *   - intent-role only; `role: 'code'` sources fall through
 *   - first-ingest does NOT fire reactor (only `source.synced` does;
 *     scaffold's `ingestAll` publishes its own `source.synced`
 *     internally so this is enforced by the event itself)
 *   - throttle: rolling 1h window per workspace; the (N+1)th dispatch
 *     emits `reactor.throttled` and drops
 *   - no gate assumption: emits `reactor.completed`, leaves apply to
 *     upstream layers (future generative axis)
 */
export class ReactorService implements Reactor {
  private readonly subscriptions = new Map<WorkspaceId, () => void>()
  private readonly throttles = new Map<WorkspaceId, ThrottleWindow>()

  constructor(private readonly deps: ReactorServiceDeps) {}

  async start(workspaceId: WorkspaceId): Promise<void> {
    if (this.subscriptions.has(workspaceId))
      return
    // Resolve the workspace once at start so the throttle picks up the
    // configured `reactor.maxRunsPerHour` and we fail fast on a bad
    // workspace id rather than per delivery.
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
    const context = await this.resolveContext(event)
    if (!context)
      return
    const changedPaths = await this.changedPathsForPass(context)
    if (changedPaths.length === 0) {
      this.emit(this.passCompleted(context, 0, false))
      return
    }
    if (this.throttleFor(context.workspace.id).isOverLimit()) {
      this.emit(this.passThrottled(context))
      return
    }
    this.throttleFor(context.workspace.id).recordDispatch()
    this.emit(this.passDispatched(context, changedPaths.length))
    const checkpointRan = await this.runDispatchLoop(context, changedPaths)
    this.emit(this.passCompleted(context, changedPaths.length, checkpointRan))
  }

  /**
   * Resolve everything the pass needs (source, ontology binding) and
   * apply the intent-role + per-unit-skill filters. Returns the
   * context when the pass should proceed; undefined to drop the event
   * silently with no observable side effect.
   */
  private async resolveContext(event: SourceSyncedEvent): Promise<PassContext | undefined> {
    const workspace = await this.deps.workspaceService.findById(event.workspaceId)
    const source = workspace.sources.find(s => s.id === event.sourceId)
    if (!isIntentSource(source))
      return undefined
    const ontology = this.deps.pluginRegistry.findOntology(workspace.productManifest.ontologyId)
    const batchBinding = ontology?.batch
    if (!batchBinding?.perUnit?.skillId)
      return undefined
    return { workspace, sourceId: event.sourceId, batchBinding }
  }

  private async changedPathsForPass(context: PassContext): Promise<readonly string[]> {
    const diff = await computeSourceDiff(this.deps, context.workspace, context.sourceId)
    return [...diff.new, ...diff.changed].map(u => u.path)
  }

  /**
   * Sequentially dispatch the per-unit skill against each path then,
   * iff at least one per-unit succeeded, dispatch the checkpoint skill
   * once. Returns whether the checkpoint actually ran.
   *
   * A per-unit failure does NOT abort the loop; the next manual sync
   * will retry the failed path once its ledger entry stays unchanged.
   */
  private async runDispatchLoop(context: PassContext, paths: readonly string[]): Promise<boolean> {
    let anySucceeded = false
    for (const path of paths) {
      const ok = await this.dispatchPerUnit(context, path)
      anySucceeded = anySucceeded || ok
    }
    const checkpointSkillId = context.batchBinding.checkpoint?.skillId
    if (anySucceeded && checkpointSkillId)
      return this.dispatchCheckpoint(context, checkpointSkillId)
    return false
  }

  private async dispatchPerUnit(context: PassContext, path: string): Promise<boolean> {
    const { workspace, sourceId, batchBinding } = context
    try {
      const args = argsForPath(batchBinding.perUnit, path)
      const runId = await this.deps.skillRunner.start(workspace, batchBinding.perUnit.skillId, args)
      await waitForCompletion(this.deps.skillRunner, runId)
      await this.deps.sourceUnitStateService.recordObservation(workspace.id, sourceId, path, runId)
      return true
    }
    catch (err) {
      reactorLogger.warn(
        {
          workspaceId: workspace.id,
          sourceId,
          path,
          err: err instanceof Error ? err.message : String(err),
        },
        'reactor: per-unit dispatch failed; continuing to next unit',
      )
      return false
    }
  }

  private async dispatchCheckpoint(context: PassContext, skillId: SkillId): Promise<boolean> {
    const { workspace } = context
    try {
      const runId = await this.deps.skillRunner.start(workspace, skillId, '')
      await waitForCompletion(this.deps.skillRunner, runId)
      return true
    }
    catch (err) {
      reactorLogger.warn(
        {
          workspaceId: workspace.id,
          skillId,
          err: err instanceof Error ? err.message : String(err),
        },
        'reactor: checkpoint dispatch failed',
      )
      return false
    }
  }

  /**
   * The throttle is always created eagerly in `start`, so this lookup
   * either returns the workspace's window or signals a bug (event
   * arrived for a workspace we never started).
   */
  private throttleFor(workspaceId: WorkspaceId): ThrottleWindow {
    const window = this.throttles.get(workspaceId)
    if (!window)
      throw new Error(`reactor: throttle not initialised for workspace "${workspaceId}"; was start() called?`)
    return window
  }

  private passDispatched(context: PassContext, totalUnits: number): WorkspaceEvent {
    return {
      type: 'reactor.dispatched',
      workspaceId: context.workspace.id,
      sourceId: context.sourceId,
      totalUnits,
      at: this.deps.clock.now(),
    }
  }

  private passCompleted(context: PassContext, totalUnits: number, checkpointRan: boolean): WorkspaceEvent {
    return {
      type: 'reactor.completed',
      workspaceId: context.workspace.id,
      sourceId: context.sourceId,
      totalUnits,
      checkpointRan,
      at: this.deps.clock.now(),
    }
  }

  private passThrottled(context: PassContext): WorkspaceEvent {
    return {
      type: 'reactor.throttled',
      workspaceId: context.workspace.id,
      sourceId: context.sourceId,
      limit: this.throttleFor(context.workspace.id).limit,
      at: this.deps.clock.now(),
    }
  }

  private emit(event: WorkspaceEvent): void {
    this.deps.eventBus.publish(event)
  }
}

function isIntentSource(source: SourceDescriptor | undefined): source is SourceDescriptor & { role: 'intent' } {
  return source?.role === 'intent'
}

/**
 * Compute the per-unit skill args for a path. The ontology's
 * `argsFor` is typed against `PlanUnit` (BatchService's domain),
 * but it only reads `name` + `scopeHint`; we honour that contract by
 * passing a minimal synthetic. Keeping the cast in one helper means
 * the rest of the reactor stays free of `as unknown as` casts.
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
