import type { SourceId, SourceUnitDiff } from '@braidhq/schema'
import type { SourceUnitDigest } from '../domain/source/SourceUnitDigest.js'
import type { Workspace } from '../domain/workspace/Workspace.js'
import type { IntentLister } from './BatchService.js'
import type { SourceUnitStateService } from './SourceUnitStateService.js'

/**
 * Compose the "current units on disk" walk with the SourceUnitState
 * ledger diff. Reactor and the `GET .../source-unit-states/:sourceId/diff`
 * REST endpoint both consume this so the two surfaces always agree on
 * what is `new` / `changed` / `unchanged` / `orphaned`.
 *
 * The function intentionally lives outside `SourceUnitStateService` so
 * the service stays a pure-ledger port (no filesystem walks, no
 * digest computation); the orchestrator composes the pieces.
 */
export interface ComputeSourceDiffDeps {
  readonly intentLister: IntentLister
  readonly digest: SourceUnitDigest
  readonly sourceUnitStateService: SourceUnitStateService
}

export async function computeSourceDiff(
  deps: ComputeSourceDiffDeps,
  workspace: Workspace,
  sourceId: SourceId,
): Promise<SourceUnitDiff> {
  const allItems = await deps.intentLister(workspace)
  const sourceItems = allItems.filter(item => item.sourceId === sourceId)
  const withSha = await Promise.all(
    sourceItems.map(async item => ({
      sourceId,
      path: item.value,
      sha: await deps.digest.computeSha(workspace, sourceId, item.value),
    })),
  )
  return deps.sourceUnitStateService.diffAgainst(workspace.id, withSha)
}
