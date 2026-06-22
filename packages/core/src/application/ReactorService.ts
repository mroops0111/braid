import type { SkillEvent, SkillId, SkillRunId, SourceDescriptor, SourceId, WorkspaceId } from '@braidhq/schema'
import type { Clock } from '../domain/Clock.js'
import type { SourceSyncedEvent } from '../domain/events/WorkspaceEvent.js'
import type { OntologyPerUnitBinding } from '../domain/plugin/Ontology.js'
import type { PluginRegistry } from '../domain/plugin/PluginRegistry.js'
import type { Reactor, ReactorSubscription } from '../domain/reactor/Reactor.js'
import type { SkillRunner } from '../domain/skill/SkillRunner.js'
import type { SourceUnitDigest } from '../domain/source/SourceUnitDigest.js'
import type { Workspace } from '../domain/workspace/Workspace.js'
import type { IntentLister } from './BatchService.js'
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
}

const reactorLogger = createLogger('reactor')

const HOUR_MS = 60 * 60 * 1000

/**
 * Reactor implementation. Listens to `source.synced` events on the
 * `WorkspaceEventBus` and, for intent-role sources, runs the active
 * ontology's per-unit skill against the diff between current units on
 * disk and the recorded SourceUnitState ledger. After all per-unit
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
  /** Unix-ms timestamps of dispatches inside the active 1h window, per workspace. */
  private readonly dispatchHistory = new Map<WorkspaceId, number[]>()

  constructor(private readonly deps: ReactorServiceDeps) {}

  async start(workspaceId: WorkspaceId): Promise<ReactorSubscription> {
    if (!this.subscriptions.has(workspaceId)) {
      const unsubscribe = this.deps.eventBus.subscribe(workspaceId, (event) => {
        if (event.type === 'source.synced')
          void this.onSourceSynced(event)
      })
      this.subscriptions.set(workspaceId, unsubscribe)
    }
    return {
      workspaceId,
      dispose: async () => this.stop(workspaceId),
    }
  }

  async stop(workspaceId: WorkspaceId): Promise<void> {
    const unsub = this.subscriptions.get(workspaceId)
    if (!unsub)
      return
    unsub()
    this.subscriptions.delete(workspaceId)
    this.dispatchHistory.delete(workspaceId)
  }

  private async onSourceSynced(event: SourceSyncedEvent): Promise<void> {
    try {
      const workspace = await this.deps.workspaceService.findById(event.workspaceId)
      const source = workspace.sources.find(s => s.id === event.sourceId)
      if (!isIntentSource(source))
        return

      const ontology = this.deps.pluginRegistry.findOntology(workspace.productManifest.ontologyId)
      const perUnitSkillId = ontology?.batch?.perUnit?.skillId
      if (!perUnitSkillId) {
        // No per-unit binding to dispatch; nothing for the reactor to do.
        return
      }

      const changedPaths = await this.computeChangedPaths(workspace, event.sourceId)
      if (changedPaths.length === 0) {
        // Sync had no effect on intent units (orphans don't count for v0).
        // Emit a completed with totalUnits: 0 so the Studio banner can show
        // a brief "nothing to do" pulse instead of silently nothing.
        this.publish({
          type: 'reactor.completed',
          workspaceId: workspace.id,
          sourceId: event.sourceId,
          totalUnits: 0,
          checkpointRan: false,
          at: this.deps.clock.now(),
        })
        return
      }

      const limit = workspace.productManifest.reactor?.maxRunsPerHour ?? 5
      if (this.exceedsThrottle(workspace.id, limit)) {
        this.publish({
          type: 'reactor.throttled',
          workspaceId: workspace.id,
          sourceId: event.sourceId,
          limit,
          at: this.deps.clock.now(),
        })
        return
      }

      this.recordDispatch(workspace.id)
      this.publish({
        type: 'reactor.dispatched',
        workspaceId: workspace.id,
        sourceId: event.sourceId,
        totalUnits: changedPaths.length,
        at: this.deps.clock.now(),
      })

      // Sequential per-unit dispatch. A failure on one unit does NOT
      // block subsequent units; the next manual sync will retry the
      // failed one once its ledger entry stays unchanged.
      const argsFor = ontology.batch.perUnit.argsFor
      let anySucceeded = false
      for (const path of changedPaths) {
        const succeeded = await this.dispatchPerUnit(workspace, event.sourceId, path, perUnitSkillId, argsFor)
        anySucceeded = anySucceeded || succeeded
      }

      // Checkpoint runs once after all per-unit dispatches settle, and
      // only if at least one per-unit succeeded — otherwise the
      // checkpoint has no fresh work to consume.
      let checkpointRan = false
      const checkpointSkillId = ontology.batch?.checkpoint?.skillId
      if (anySucceeded && checkpointSkillId) {
        checkpointRan = await this.dispatchCheckpoint(workspace, checkpointSkillId)
      }

      this.publish({
        type: 'reactor.completed',
        workspaceId: workspace.id,
        sourceId: event.sourceId,
        totalUnits: changedPaths.length,
        checkpointRan,
        at: this.deps.clock.now(),
      })
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

  /**
   * Walk the synced source's units on disk, compute their shas, and
   * return the paths that are new or changed against the ledger.
   * Orphans (in ledger, not on disk) are intentionally NOT re-dispatched
   * in v0: the per-unit skill consumes the unit's current content, and a
   * deleted unit has nothing to consume.
   */
  private async computeChangedPaths(workspace: Workspace, sourceId: SourceId): Promise<readonly string[]> {
    const diff = await computeSourceDiff(this.deps, workspace, sourceId)
    return [...diff.new, ...diff.changed].map(u => u.path)
  }

  private async dispatchPerUnit(
    workspace: Workspace,
    sourceId: SourceId,
    path: string,
    skillId: SkillId,
    argsFor: OntologyPerUnitBinding['argsFor'],
  ): Promise<boolean> {
    try {
      // argsFor is typed against PlanUnit but only reads name + scopeHint.
      // Cast the synthetic through `unknown` so we don't drag a PlanUnit
      // builder into the reactor for what is a one-field read.
      const synthetic = { name: path, scopeHint: path } as unknown as Parameters<NonNullable<OntologyPerUnitBinding['argsFor']>>[0]
      const args = argsFor ? argsFor(synthetic) : path
      const runId = await this.deps.skillRunner.start(workspace, skillId, args)
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

  private async dispatchCheckpoint(workspace: Workspace, skillId: SkillId): Promise<boolean> {
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

  private exceedsThrottle(workspaceId: WorkspaceId, limit: number): boolean {
    const cutoff = Date.parse(this.deps.clock.now()) - HOUR_MS
    const history = this.dispatchHistory.get(workspaceId) ?? []
    const recent = history.filter(ts => ts >= cutoff)
    if (recent.length !== history.length)
      this.dispatchHistory.set(workspaceId, recent)
    return recent.length >= limit
  }

  private recordDispatch(workspaceId: WorkspaceId): void {
    const history = this.dispatchHistory.get(workspaceId) ?? []
    history.push(Date.parse(this.deps.clock.now()))
    this.dispatchHistory.set(workspaceId, history)
  }

  private publish(event: Parameters<WorkspaceEventBus['publish']>[0]): void {
    this.deps.eventBus.publish(event)
  }
}

function isIntentSource(source: SourceDescriptor | undefined): source is SourceDescriptor & { role: 'intent' } {
  return source?.role === 'intent'
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
