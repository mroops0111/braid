import type { SkillRunId, SourceId, SourceUnitDiff, SourceUnitObservation, WorkspaceId } from '@braidhq/schema'
import type { Clock } from '../domain/Clock.js'
import type { SourceUnitDigest } from '../domain/source/SourceUnitDigest.js'
import type { SourceUnitObservationRepository } from '../domain/source/SourceUnitObservationRepository.js'
import type { WorkspaceService } from './WorkspaceService.js'
import { computeSourceUnitDiff } from '../domain/source/computeSourceUnitDiff.js'

export interface SourceUnitObservationServiceDeps {
  repository: SourceUnitObservationRepository
  digest: SourceUnitDigest
  workspaceService: WorkspaceService
  clock: Clock
}

/**
 * Application-level entry point for recording and querying source unit observations.
 * Every orchestrator that runs a skill against a source unit (BatchService today,
 * ReactorService and manual-extract dispatch later) goes through `recordObservation`,
 * so the audit and diff primitives stay in one place.
 *
 * Reads (`listByWorkspace`, `diffAgainst`) are delegated to the repository / pure diff function.
 * The service exists mostly to (a) fan-in writes with sha computation,
 * and (b) give callers a stable surface even if persistence later moves to a database.
 */
export class SourceUnitObservationService {
  constructor(private readonly deps: SourceUnitObservationServiceDeps) {}

  async recordObservation(
    workspaceId: WorkspaceId,
    sourceId: SourceId,
    path: string,
    runId?: SkillRunId,
  ): Promise<SourceUnitObservation> {
    const workspace = await this.deps.workspaceService.findById(workspaceId)
    const sha = await this.deps.digest.computeSha(workspace, sourceId, path)
    const state: SourceUnitObservation = {
      workspaceId,
      sourceId,
      path,
      lastObservedSha: sha,
      lastObservedAt: this.deps.clock.now(),
      ...(runId ? { lastObservedByRunId: runId } : {}),
    }
    await this.deps.repository.save(state)
    return state
  }

  async listByWorkspace(workspaceId: WorkspaceId): Promise<readonly SourceUnitObservation[]> {
    return this.deps.repository.listByWorkspace(workspaceId)
  }

  async listBySource(workspaceId: WorkspaceId, sourceId: SourceId): Promise<readonly SourceUnitObservation[]> {
    return this.deps.repository.listBySource(workspaceId, sourceId)
  }

  /**
   * Compute the partition of `units` against what's currently recorded for this workspace.
   * Used by Reactor to decide which units to re-extract, useful in tests for asserting batch progress.
   */
  async diffAgainst(workspaceId: WorkspaceId, units: ReadonlyArray<{ sourceId: SourceId, path: string, sha: SourceUnitObservation['lastObservedSha'] }>): Promise<SourceUnitDiff> {
    const states = await this.deps.repository.listByWorkspace(workspaceId)
    return computeSourceUnitDiff(states, units)
  }
}
