import type { SourceId, WorkspaceId } from '@braidhq/schema'
import type { Mock } from 'vitest'
import type { SourceSyncExecutor } from '../../src/application/SourceSyncService.js'
import { at, FixedClock, makeFilesystemSource, makeWorkspace } from '@braidhq/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SourcePollingService } from '../../src/application/SourcePollingService.js'
import { SourceSyncService } from '../../src/application/SourceSyncService.js'
import { TaskCoalescer } from '../../src/application/TaskCoalescer.js'
import { Workspace } from '../../src/domain/workspace/Workspace.js'
import { InMemorySourceSyncStateRepository } from '../../src/infrastructure/in-memory/InMemorySourceSyncStateRepository.js'

const WORKSPACE_ID = 'ws-1' as WorkspaceId
const MANAGED = 'src-managed' as SourceId
const BUDGET_MS = 60_000
const BUDGET_SECONDS = BUDGET_MS / 1000

const silentLogger = { info() {}, warn() {}, error() {} }

/** A source that refreshes on its own, the case the poller acts on. */
function managed(id: SourceId, maxStalenessMs = BUDGET_MS) {
  return makeFilesystemSource({ id, maxStalenessMs })
}

/**
 * Stands in for `SystemScheduler` so a test advances the loop deliberately,
 * rather than sleeping on wall-clock timers.
 */
class ManualScheduler {
  readonly pending: { delayMs: number, task: () => void }[] = []

  schedule(delayMs: number, task: () => void): { cancel: () => void } {
    const entry = { delayMs, task }
    this.pending.push(entry)
    return {
      cancel: () => {
        const index = this.pending.indexOf(entry)
        if (index >= 0)
          this.pending.splice(index, 1)
      },
    }
  }
}

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

describe('SourcePollingService', () => {
  let scheduler: ManualScheduler
  let workspace: Workspace
  let clock: FixedClock
  let syncOne: Mock<SourceSyncExecutor['syncOne']>
  let sourceSyncService: SourceSyncService
  let polling: SourcePollingService

  function build(overrides: Partial<ConstructorParameters<typeof SourcePollingService>[0]> = {}): SourcePollingService {
    return new SourcePollingService({
      sourceSyncService,
      workspaceService: { findById: async () => workspace },
      scheduler,
      clock,
      logger: silentLogger,
      ...overrides,
    })
  }

  /** Fire the armed timer and let the pass plus its re-arm settle. */
  async function advance(): Promise<void> {
    scheduler.pending.shift()?.task()
    await flush()
  }

  /** Source ids fetched so far, in call order. */
  function fetched(): string[] {
    return syncOne.mock.calls.map(call => String(call[1]))
  }

  beforeEach(() => {
    scheduler = new ManualScheduler()
    workspace = makeWorkspace({ id: WORKSPACE_ID, sources: [managed(MANAGED)] })
    clock = new FixedClock(at(0))
    syncOne = vi.fn(async () => ({ changed: true, fetchedAt: at(0) }))
    sourceSyncService = new SourceSyncService({
      sourceLoaderRunner: { syncOne },
      syncStateRepository: new InMemorySourceSyncStateRepository(),
      coalescer: new TaskCoalescer(),
      clock,
      logger: silentLogger,
    })
    polling = build()
  })

  it('refreshes a source that has never synced', async () => {
    await polling.start(WORKSPACE_ID)
    await advance()

    expect(fetched()).toEqual([MANAGED])
  })

  it('leaves a freshly synced source alone', async () => {
    await sourceSyncService.syncNow(workspace, MANAGED)
    syncOne.mockClear()

    await polling.start(WORKSPACE_ID)
    await advance()

    expect(syncOne).not.toHaveBeenCalled()
  })

  it('warms a source before its budget expires, so a run does not wait', async () => {
    await sourceSyncService.syncNow(workspace, MANAGED)
    syncOne.mockClear()
    clock.set(at(BUDGET_SECONDS))

    await polling.start(WORKSPACE_ID)
    await advance()

    expect(fetched()).toEqual([MANAGED])
  })

  it('ignores a source with no staleness budget', async () => {
    workspace = makeWorkspace({
      id: WORKSPACE_ID,
      sources: [managed(MANAGED), makeFilesystemSource({ id: 'src-plain' as SourceId })],
    })

    await polling.start(WORKSPACE_ID)
    await advance()

    expect(fetched()).toEqual([MANAGED])
  })

  it('does nothing while the workspace kill switch is off', async () => {
    const base = workspace.toData()
    workspace = new Workspace({
      ...base,
      productManifest: { ...base.productManifest, polling: { enabled: false } },
    })

    await polling.start(WORKSPACE_ID)
    await advance()

    expect(syncOne).not.toHaveBeenCalled()
  })

  it('skips a workspace whose sources a run is holding', async () => {
    polling = build({ isWorkspaceBusy: () => true })

    await polling.start(WORKSPACE_ID)
    await advance()

    expect(syncOne).not.toHaveBeenCalled()
  })

  it('never holds a healthy source back, so the budget alone paces it', async () => {
    await polling.start(WORKSPACE_ID)
    await advance()
    clock.set(at(BUDGET_SECONDS))
    await advance()

    expect(syncOne).toHaveBeenCalledTimes(2)
  })

  describe('backoff', () => {
    // Base backoff equals the budget, so a window reads as one BACKOFF_SECONDS.
    const BACKOFF_SECONDS = BUDGET_SECONDS

    beforeEach(() => {
      syncOne.mockRejectedValue(new Error('unreachable'))
      polling = build({ baseBackoffMs: BUDGET_MS, maximumBackoffMs: 10 * BUDGET_MS })
    })

    it('holds a failing source off until its backoff elapses', async () => {
      await polling.start(WORKSPACE_ID)
      await advance()
      expect(syncOne).toHaveBeenCalledTimes(1)

      clock.set(at(BACKOFF_SECONDS / 2))
      await advance()
      expect(syncOne).toHaveBeenCalledTimes(1)

      clock.set(at(BACKOFF_SECONDS))
      await advance()
      expect(syncOne).toHaveBeenCalledTimes(2)
    })

    it('doubles the wait after each further failure', async () => {
      await polling.start(WORKSPACE_ID)
      await advance()
      clock.set(at(BACKOFF_SECONDS))
      await advance()
      expect(syncOne).toHaveBeenCalledTimes(2)

      // Two failures now, so the next window is twice the base.
      clock.set(at(BACKOFF_SECONDS * 2))
      await advance()
      expect(syncOne).toHaveBeenCalledTimes(2)

      clock.set(at(BACKOFF_SECONDS * 3))
      await advance()
      expect(syncOne).toHaveBeenCalledTimes(3)
    })
  })

  describe('the loop itself', () => {
    it('wakes at a quarter of the tightest budget, so a warm window is not overshot', async () => {
      const eightMinutesMs = 480_000
      workspace = makeWorkspace({ id: WORKSPACE_ID, sources: [managed(MANAGED, eightMinutesMs)] })

      await polling.start(WORKSPACE_ID)

      expect(scheduler.pending[0]?.delayMs).toBe(eightMinutesMs / 4)
    })

    it('arms nothing for a workspace with no source to warm', async () => {
      workspace = makeWorkspace({ id: WORKSPACE_ID, sources: [makeFilesystemSource({ id: MANAGED })] })

      await polling.start(WORKSPACE_ID)

      expect(scheduler.pending).toHaveLength(0)
    })

    it('re-arms after each pass rather than on a fixed period', async () => {
      await polling.start(WORKSPACE_ID)
      await advance()

      expect(scheduler.pending).toHaveLength(1)
    })

    it('keeps the loop alive when a pass throws', async () => {
      syncOne.mockRejectedValue(new Error('unreachable'))

      await polling.start(WORKSPACE_ID)
      await advance()

      expect(scheduler.pending).toHaveLength(1)
    })

    it('starts a workspace only once', async () => {
      await polling.start(WORKSPACE_ID)
      await polling.start(WORKSPACE_ID)

      expect(scheduler.pending).toHaveLength(1)
    })

    it('ends the loop once stopped', async () => {
      await polling.start(WORKSPACE_ID)
      polling.stop(WORKSPACE_ID)

      expect(scheduler.pending).toHaveLength(0)
    })

    it('does not re-arm when stopped mid-pass', async () => {
      await polling.start(WORKSPACE_ID)
      const armed = scheduler.pending[0]
      polling.stop(WORKSPACE_ID)
      armed?.task()
      await flush()

      expect(scheduler.pending).toHaveLength(0)
    })

    it('stopAll clears every workspace loop', async () => {
      await polling.start(WORKSPACE_ID)
      polling.stopAll()

      expect(scheduler.pending).toHaveLength(0)
    })
  })
})
