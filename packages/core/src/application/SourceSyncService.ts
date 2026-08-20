import type { SourceId } from '@braidhq/schema'
import type { Clock } from '../domain/Clock.js'
import type { Logger } from '../domain/Logger.js'
import type { SyncReport } from '../domain/plugin/SourceLoaderPlugin.js'
import type { SourceSyncStateRepository } from '../domain/source/SourceSyncStateRepository.js'
import type { Workspace } from '../domain/workspace/Workspace.js'
import type { ProvisionOutcome } from './SourceLoaderRunner.js'
import type { TaskCoalescer } from './TaskCoalescer.js'
import { SourceSyncState } from '../domain/source/SourceSyncState.js'

/**
 * The single capability this service needs from the loader layer.
 * Narrower than `SourceLoaderRunner`, which also provisions, so the seam
 * states what is actually depended on and a test needs no runner instance.
 */
export interface SourceSyncExecutor {
  syncOne: (workspace: Workspace, sourceId: SourceId) => Promise<SyncReport>
}

/**
 * What happened to one source when the caller asked for it to be current.
 *
 * `failed` is not an error case for the caller. A refresh that could not reach
 * its remote leaves the previous mirror in place, which is still readable.
 */
export type SourceRefreshOutcome =
  | { readonly sourceId: SourceId, readonly outcome: 'fresh' | 'synced' | 'unmanaged' | 'timedOut' }
  | { readonly sourceId: SourceId, readonly outcome: 'failed', readonly error: string }

export interface EnsureWorkspaceFreshOptions {
  /**
   * How long to wait on refreshes before giving up and reporting `timedOut`.
   * A caller with a request open needs this, since git offers no timeout of
   * its own and one unresponsive remote would otherwise wedge the call.
   * The pass itself keeps running and its result lands in the sync state.
   */
  readonly deadlineMs?: number
}

export interface SourceSyncServiceDeps {
  readonly sourceLoaderRunner: SourceSyncExecutor
  readonly syncStateRepository: SourceSyncStateRepository
  readonly coalescer: TaskCoalescer
  readonly clock: Clock
  readonly logger: Logger
}

/**
 * The one entry point for every sync trigger, whether that is boot catch-up, a
 * webhook delivery, the Studio button, or the background poller.
 *
 * It owns three things the loader layer deliberately does not. Concurrent
 * callers for one source collapse to a single pass, every attempt lands in the
 * sync-state store, and `ensureFresh` decides whether a pass is needed at all.
 * `SourceLoaderRunner` stays a thin adapter over the plugin port.
 *
 * Going around this service and calling the runner directly still syncs, but
 * records nothing and takes no lock, so new call sites belong here.
 */
export class SourceSyncService {
  constructor(private readonly deps: SourceSyncServiceDeps) {}

  /**
   * Refresh regardless of how recently it last ran, and surface failures.
   * Callers with a human waiting on the answer want the error.
   */
  async syncNow(workspace: Workspace, sourceId: SourceId): Promise<SyncReport> {
    return this.deps.coalescer.run(coalesceKey(workspace, sourceId), async () => {
      // Stamped before the pass, not after. The loader observed its remote
      // somewhere inside the window, so the earlier bound is the honest one.
      const attemptedAt = this.deps.clock.now()
      try {
        const report = await this.deps.sourceLoaderRunner.syncOne(workspace, sourceId)
        await this.record(workspace, sourceId, priorState =>
          priorState.recordSuccess(attemptedAt, report.revision))
        return report
      }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await this.record(workspace, sourceId, priorState =>
          priorState.recordFailure(attemptedAt, message))
        throw error
      }
    })
  }

  /**
   * Take the first fill of a scaffolded workspace into the sync state.
   *
   * Separate from provisioning itself because a workspace is only registered
   * once its sources are on disk, and the state store resolves its path
   * through that registration. The caller provisions, registers, then reports
   * here. Without this a fresh mirror would read as never synced, so the first
   * run would refetch what it already has.
   */
  async recordProvisioned(workspace: Workspace, outcomes: readonly ProvisionOutcome[]): Promise<void> {
    const provisionedAt = this.deps.clock.now()
    for (const outcome of outcomes) {
      await this.record(workspace, outcome.sourceId, priorState =>
        priorState.recordSuccess(provisionedAt, outcome.report.revision))
    }
  }

  /**
   * Bring one source within its staleness budget, best effort.
   *
   * A failure here never propagates. Refusing to run because a mirror could
   * not be refreshed would let one unreachable remote block every skill run in
   * the workspace, which is worse than reading a mirror that is an hour old.
   * The attempt is recorded either way, so the staleness surfaces in Studio.
   */
  async ensureFresh(workspace: Workspace, sourceId: SourceId): Promise<SourceRefreshOutcome> {
    const policy = workspace.syncPolicyFor(sourceId)
    if (!policy)
      return { sourceId, outcome: 'unmanaged' }
    const state = await this.loadState(workspace, sourceId)
    if (state.isFreshAt(this.deps.clock.now(), policy))
      return { sourceId, outcome: 'fresh' }
    try {
      await this.syncNow(workspace, sourceId)
      return { sourceId, outcome: 'synced' }
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.deps.logger.warn(
        { workspaceId: workspace.id, sourceId, err: message },
        'source refresh failed, continuing against the existing mirror',
      )
      return { sourceId, outcome: 'failed', error: message }
    }
  }

  /**
   * Bring every managed source in the workspace within budget, concurrently.
   * Sources sharing no working tree cannot contend, and a single slow remote
   * should not hold up the rest.
   */
  async ensureWorkspaceFresh(
    workspace: Workspace,
    options: EnsureWorkspaceFreshOptions = {},
  ): Promise<readonly SourceRefreshOutcome[]> {
    const { deadlineMs } = options
    return Promise.all(workspace.managedSources().map((source) => {
      const pass = this.ensureFresh(workspace, source.id)
      return deadlineMs === undefined
        ? pass
        : withDeadline(pass, deadlineMs, { sourceId: source.id, outcome: 'timedOut' as const })
    }))
  }

  async loadState(workspace: Workspace, sourceId: SourceId): Promise<SourceSyncState> {
    const stored = await this.deps.syncStateRepository.find(workspace.id, sourceId)
    return stored ? new SourceSyncState(stored) : SourceSyncState.initial(workspace.id, sourceId)
  }

  private async record(
    workspace: Workspace,
    sourceId: SourceId,
    transition: (priorState: SourceSyncState) => SourceSyncState,
  ): Promise<void> {
    const priorState = await this.loadState(workspace, sourceId)
    await this.deps.syncStateRepository.save(transition(priorState).toData())
  }
}

function coalesceKey(workspace: Workspace, sourceId: SourceId): string {
  return `${workspace.id}::${sourceId}`
}

/**
 * Resolve `fallback` once `deadlineMs` passes, leaving the original pass to
 * finish in the background. Its outcome still reaches the sync state, so a slow
 * remote surfaces in Studio rather than being lost with the abandoned wait.
 */
async function withDeadline<T>(pass: Promise<T>, deadlineMs: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expiry = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), deadlineMs)
  })
  try {
    return await Promise.race([pass, expiry])
  }
  finally {
    clearTimeout(timer)
  }
}
