import { z } from 'zod'
import { SourceId, Timestamp, WorkspaceId } from './common.js'

/**
 * How stale a source may be before something reads it.
 * One knob rather than a separate poll interval,
 * since a cadence that disagrees with the budget either spins on
 * already-fresh sources or leaves the budget unenforced between ticks.
 * The poller derives its wake-up from this.
 *
 * Absent on a source means it never refreshes on its own,
 * so an existing workspace keeps its manual-only behaviour until it opts in.
 */
export const SourceSyncPolicy = z.object({
  maxStalenessMs: z.number().int().positive(),
})
export type SourceSyncPolicy = z.infer<typeof SourceSyncPolicy>

/**
 * Whether the workspace runs background refreshes at all.
 * A kill switch for the timer, not a second opt-in gate,
 * since the per-source policy already decides who participates.
 * Reaching for it stops outbound load on a struggling remote
 * without editing every source and losing their budgets.
 */
export const WorkspacePollingConfig = z.object({
  enabled: z.boolean().default(true),
})
export type WorkspacePollingConfig = z.infer<typeof WorkspacePollingConfig>

/**
 * What the last sync attempts did, per source.
 * Persisted because a stale mirror is otherwise silent,
 * and because the freshness check reads `lastSuccessAt` to decide.
 *
 * `revision` is whatever provenance the loader reports,
 * a commit sha for git, something else elsewhere,
 * so the record stays loader-agnostic.
 */
export const SourceSyncState = z.object({
  workspaceId: WorkspaceId,
  sourceId: SourceId,
  lastAttemptAt: Timestamp.optional(),
  lastSuccessAt: Timestamp.optional(),
  revision: z.string().optional(),
  consecutiveFailures: z.number().int().nonnegative().default(0),
  lastError: z.string().optional(),
})
export type SourceSyncState = z.infer<typeof SourceSyncState>
