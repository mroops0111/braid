import type { AbsolutePath, SourceId } from '@braidhq/schema'
import type { Mock } from 'vitest'
import type { SourceSyncExecutor } from '../../src/application/SourceSyncService.js'
import type { SyncReport } from '../../src/domain/plugin/SourceLoaderPlugin.js'
import type { Workspace } from '../../src/domain/workspace/Workspace.js'
import { at, FixedClock, makeFilesystemSource, makeWorkspace } from '@braidhq/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SourceSyncService } from '../../src/application/SourceSyncService.js'
import { TaskCoalescer } from '../../src/application/TaskCoalescer.js'
import { InMemorySourceSyncStateRepository } from '../../src/infrastructure/in-memory/InMemorySourceSyncStateRepository.js'

const MANAGED = 'src-managed' as SourceId
const UNMANAGED = 'src-unmanaged' as SourceId
const BUDGET_MS = 60_000
const BUDGET_SECONDS = BUDGET_MS / 1000

/** A source that refreshes on its own, the case most of these tests exercise. */
function managed(id: SourceId) {
  return makeFilesystemSource({ id, maxStalenessMs: BUDGET_MS })
}

function report(revision?: string): SyncReport {
  return { changed: true, fetchedAt: at(0), ...(revision === undefined ? {} : { revision }) }
}

describe('SourceSyncService', () => {
  let workspace: Workspace
  let clock: FixedClock
  let syncStateRepository: InMemorySourceSyncStateRepository
  let syncOne: Mock<SourceSyncExecutor['syncOne']>
  let service: SourceSyncService

  beforeEach(() => {
    workspace = makeWorkspace({ sources: [managed(MANAGED), makeFilesystemSource({ id: UNMANAGED })] })
    clock = new FixedClock(at(0))
    syncStateRepository = new InMemorySourceSyncStateRepository()
    syncOne = vi.fn(async () => report('abc123'))
    service = new SourceSyncService({
      sourceLoaderRunner: { syncOne },
      syncStateRepository,
      coalescer: new TaskCoalescer(),
      clock,
      logger: { info() {}, warn() {}, error() {} },
    })
  })

  describe('syncNow', () => {
    it('records the attempt and its revision on success', async () => {
      clock.set(at(30))
      await service.syncNow(workspace, MANAGED)

      const state = await service.loadState(workspace, MANAGED)
      expect(state.lastSuccessAt).toBe(at(30))
      expect(state.revision).toBe('abc123')
      expect(state.consecutiveFailures).toBe(0)
    })

    it('records a failure and rethrows, so a waiting human sees the error', async () => {
      syncOne.mockRejectedValueOnce(new Error('remote unreachable'))

      await expect(service.syncNow(workspace, MANAGED)).rejects.toThrow('remote unreachable')

      const state = await service.loadState(workspace, MANAGED)
      expect(state.consecutiveFailures).toBe(1)
      expect(state.lastError).toBe('remote unreachable')
      expect(state.lastSuccessAt).toBeUndefined()
    })

    it('collapses concurrent callers into one pass', async () => {
      await Promise.all([
        service.syncNow(workspace, MANAGED),
        service.syncNow(workspace, MANAGED),
        service.syncNow(workspace, MANAGED),
      ])
      expect(syncOne).toHaveBeenCalledTimes(1)
    })

    it('syncs an unmanaged source too, since a manual trigger is not budget-gated', async () => {
      await service.syncNow(workspace, UNMANAGED)
      expect(syncOne).toHaveBeenCalledTimes(1)
    })

    it('stamps the attempt from before the pass, so the budget never overstates freshness', async () => {
      syncOne.mockImplementationOnce(async () => {
        clock.set(at(120))
        return report()
      })
      await service.syncNow(workspace, MANAGED)
      expect((await service.loadState(workspace, MANAGED)).lastSuccessAt).toBe(at(0))
    })
  })

  describe('recordProvisioned', () => {
    const outcomes = [{
      sourceId: MANAGED,
      report: { localPath: '/abs/ws/code' as AbsolutePath, revision: 'seed123', fetchedAt: at(0) },
    }]

    it('records the first fill, so a fresh mirror does not read as never synced', async () => {
      clock.set(at(10))
      await service.recordProvisioned(workspace, outcomes)

      const state = await service.loadState(workspace, MANAGED)
      expect(state.lastSuccessAt).toBe(at(10))
      expect(state.revision).toBe('seed123')
    })

    it('leaves the provisioned source inside its budget, so the next read does not refetch', async () => {
      await service.recordProvisioned(workspace, outcomes)

      expect(await service.ensureFresh(workspace, MANAGED)).toEqual({ sourceId: MANAGED, outcome: 'fresh' })
      expect(syncOne).not.toHaveBeenCalled()
    })
  })

  describe('ensureFresh', () => {
    it('leaves a source with no policy alone', async () => {
      expect(await service.ensureFresh(workspace, UNMANAGED)).toEqual({ sourceId: UNMANAGED, outcome: 'unmanaged' })
      expect(syncOne).not.toHaveBeenCalled()
    })

    it('syncs a source that has never synced', async () => {
      expect(await service.ensureFresh(workspace, MANAGED)).toEqual({ sourceId: MANAGED, outcome: 'synced' })
      expect(syncOne).toHaveBeenCalledTimes(1)
    })

    it('skips a source still inside its budget', async () => {
      await service.syncNow(workspace, MANAGED)
      syncOne.mockClear()
      clock.set(at(BUDGET_SECONDS - 1))

      expect(await service.ensureFresh(workspace, MANAGED)).toEqual({ sourceId: MANAGED, outcome: 'fresh' })
      expect(syncOne).not.toHaveBeenCalled()
    })

    it('syncs again once the budget has elapsed', async () => {
      await service.syncNow(workspace, MANAGED)
      syncOne.mockClear()
      clock.set(at(BUDGET_SECONDS))

      expect(await service.ensureFresh(workspace, MANAGED)).toEqual({ sourceId: MANAGED, outcome: 'synced' })
      expect(syncOne).toHaveBeenCalledTimes(1)
    })

    it('swallows a sync failure so one unreachable remote cannot block a run', async () => {
      syncOne.mockRejectedValueOnce(new Error('token expired'))

      const outcome = await service.ensureFresh(workspace, MANAGED)

      expect(outcome).toEqual({ sourceId: MANAGED, outcome: 'failed', error: 'token expired' })
      expect((await service.loadState(workspace, MANAGED)).consecutiveFailures).toBe(1)
    })
  })

  describe('ensureWorkspaceFresh', () => {
    it('covers every managed source and ignores the rest', async () => {
      const outcomes = await service.ensureWorkspaceFresh(workspace)
      expect(outcomes).toEqual([{ sourceId: MANAGED, outcome: 'synced' }])
      expect(syncOne).toHaveBeenCalledTimes(1)
    })

    it('gives up on a hung remote at the deadline and lets the caller proceed', async () => {
      syncOne.mockImplementationOnce(() => new Promise(() => {}))

      const outcomes = await service.ensureWorkspaceFresh(workspace, { deadlineMs: 10 })

      expect(outcomes).toEqual([{ sourceId: MANAGED, outcome: 'timedOut' }])
    })

    it('keeps going when one source fails', async () => {
      const second = 'src-second' as SourceId
      workspace = makeWorkspace({ sources: [managed(MANAGED), managed(second)] })
      syncOne.mockImplementation(async (_workspace: Workspace, sourceId: SourceId) => {
        if (sourceId === MANAGED)
          throw new Error('unreachable')
        return report()
      })

      const outcomes = await service.ensureWorkspaceFresh(workspace)

      expect(outcomes).toEqual([
        { sourceId: MANAGED, outcome: 'failed', error: 'unreachable' },
        { sourceId: second, outcome: 'synced' },
      ])
    })
  })
})
