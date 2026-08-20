import type { SourceId, SourceSyncPolicy, Timestamp, WorkspaceId } from '@braidhq/schema'
import type { Clock } from '../domain/Clock.js'
import type { Logger } from '../domain/Logger.js'
import type { ScheduledTask, Scheduler } from '../domain/Scheduler.js'
import type { SourceSyncState } from '../domain/source/SourceSyncState.js'
import type { Workspace } from '../domain/workspace/Workspace.js'
import type { SourceSyncService } from './SourceSyncService.js'

const MINIMUM_TICK_MS = 30_000
const MAXIMUM_TICK_MS = 15 * 60_000
const DEFAULT_BASE_BACKOFF_MS = 60_000
const DEFAULT_MAXIMUM_BACKOFF_MS = 60 * 60_000

/**
 * The single capability this service needs to reach a workspace.
 * Narrower than `WorkspaceService`, so the seam names what is depended on.
 */
export interface WorkspaceLookup {
  findById: (workspaceId: WorkspaceId) => Promise<Workspace>
}

export interface SourcePollingServiceDeps {
  readonly sourceSyncService: SourceSyncService
  readonly workspaceService: WorkspaceLookup
  readonly scheduler: Scheduler
  readonly clock: Clock
  readonly logger: Logger
  /**
   * A busy workspace is skipped, not waited on,
   * since holding a background pass for the length of a run buys nothing.
   * Absent means never skip.
   */
  readonly isWorkspaceBusy?: (workspaceId: WorkspaceId) => boolean
  readonly baseBackoffMs?: number
  readonly maximumBackoffMs?: number
}

/**
 * One timer per workspace, not per source. Each tick re-reads the manifest,
 * so an added or removed source needs no config-change listener,
 * and the timer count does not grow with the repo count.
 *
 * Correctness does not depend on this service.
 * `ensureFresh` enforces the budget when a source is read,
 * so a stopped poller costs latency, never staleness.
 */
export class SourcePollingService {
  private readonly timers = new Map<WorkspaceId, ScheduledTask>()

  constructor(private readonly deps: SourcePollingServiceDeps) {}

  /**
   * Callers that already hold the workspace pass it, the common case at boot,
   * which avoids re-reading the registry and every manifest per call.
   *
   * Nothing to warm means nothing to schedule.
   * Arming regardless leaves a timer on every workspace that never opted in,
   * reading the filesystem forever to rediscover it has nothing to do.
   * Whoever sets the first schedule starts the loop.
   */
  async start(workspaceId: WorkspaceId, known?: Workspace): Promise<void> {
    if (this.timers.has(workspaceId))
      return
    const workspace = known ?? await this.load(workspaceId)
    if (!workspace || workspace.managedSources().length === 0)
      return
    await this.arm(workspaceId, workspace)
  }

  private async load(workspaceId: WorkspaceId): Promise<Workspace | undefined> {
    try {
      return await this.deps.workspaceService.findById(workspaceId)
    }
    catch {
      return undefined
    }
  }

  stop(workspaceId: WorkspaceId): void {
    this.timers.get(workspaceId)?.cancel()
    this.timers.delete(workspaceId)
  }

  stopAll(): void {
    for (const task of this.timers.values())
      task.cancel()
    this.timers.clear()
  }

  private async tick(workspaceId: WorkspaceId): Promise<void> {
    const workspace = await this.deps.workspaceService.findById(workspaceId)
    if (!workspace.isPollingEnabled())
      return
    if (this.deps.isWorkspaceBusy?.(workspaceId))
      return
    const now = this.deps.clock.now()
    for (const source of workspace.managedSources()) {
      const state = await this.deps.sourceSyncService.loadState(workspace, source.id)
      if (this.isDue(state, source.id, source.sync, now))
        await this.deps.sourceSyncService.ensureFresh(workspace, source.id)
    }
  }

  private isDue(state: SourceSyncState, sourceId: SourceId, policy: SourceSyncPolicy, now: Timestamp): boolean {
    const sinceAttempt = state.lastAttemptAt === undefined
      ? Number.POSITIVE_INFINITY
      : Date.parse(now) - Date.parse(state.lastAttemptAt)
    if (sinceAttempt < this.backoffFor(state.consecutiveFailures))
      return false
    const staleness = state.stalenessAt(now)
    return staleness === undefined || staleness >= warmThresholdMs(policy, sourceId)
  }

  private backoffFor(consecutiveFailures: number): number {
    return backoffDelayMs(
      consecutiveFailures,
      this.deps.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS,
      this.deps.maximumBackoffMs ?? DEFAULT_MAXIMUM_BACKOFF_MS,
    )
  }

  private async arm(workspaceId: WorkspaceId, known?: Workspace): Promise<void> {
    const delay = await this.tickDelayFor(workspaceId, known)
    const task = this.deps.scheduler.schedule(delay, () => {
      void this.runScheduledTick(workspaceId)
    })
    this.timers.set(workspaceId, task)
  }

  private async runScheduledTick(workspaceId: WorkspaceId): Promise<void> {
    try {
      await this.tick(workspaceId)
    }
    catch (error) {
      this.deps.logger.error(
        { workspaceId, err: error instanceof Error ? error.message : String(error) },
        'source polling tick failed',
      )
    }
    // Re-arm only while still started, so `stop` during a tick ends the loop.
    // Re-arming after the pass, not on a fixed period,
    // keeps a slow refresh from stacking ticks behind it.
    if (this.timers.has(workspaceId))
      await this.arm(workspaceId)
  }

  private async tickDelayFor(workspaceId: WorkspaceId, known?: Workspace): Promise<number> {
    try {
      const workspace = known ?? await this.deps.workspaceService.findById(workspaceId)
      const budgets = workspace.managedSources().map(source => source.sync.maxStalenessMs)
      if (budgets.length === 0)
        return MAXIMUM_TICK_MS
      // A quarter of the tightest budget,
      // so a source is checked several times inside its window,
      // and the warm threshold is not overshot by a whole tick.
      return clamp(Math.min(...budgets) / 4, MINIMUM_TICK_MS, MAXIMUM_TICK_MS)
    }
    catch {
      // A workspace that cannot be read right now, e.g. mid-rename,
      // should not kill the loop.
      // Back off to the slowest cadence and look again.
      return MAXIMUM_TICK_MS
    }
  }
}

/**
 * How long a source may sit before the poller warms it,
 * somewhere between half and all of its budget.
 * Spreading it keeps a dozen repos off one remote in the same instant,
 * and warming before the budget expires is what stops a run waiting.
 *
 * The offset comes from the source id rather than a random draw,
 * so a restart does not reshuffle which sources come due when.
 */
function warmThresholdMs(policy: SourceSyncPolicy, sourceId: SourceId): number {
  return policy.maxStalenessMs * (0.5 + 0.5 * hashFraction(sourceId))
}

function backoffDelayMs(consecutiveFailures: number, baseMs: number, capMs: number): number {
  if (consecutiveFailures <= 0)
    return 0
  return Math.min(capMs, baseMs * 2 ** (consecutiveFailures - 1))
}

/** FNV-1a over the id, mapped into [0, 1). */
function hashFraction(value: string): number {
  let hash = 0x811C9DC5
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash / 0x100000000
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
