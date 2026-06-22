import { z } from 'zod'
import { SkillId, SkillRunId, SourceId, Timestamp, WorkspaceId } from './common.js'

/**
 * Identity of one reactor pass — i.e. one event-driven run of "diff
 * the source, dispatch the per-unit skill on the changed units, then
 * checkpoint". Branded so the type system catches accidental swaps
 * with `SourceId`, `SkillRunId`, etc.
 */
export const ReactorPassId = z.string().min(1).brand<'ReactorPassId'>()
export type ReactorPassId = z.infer<typeof ReactorPassId>

export const ReactorUnitStatus = z.enum(['queued', 'running', 'success', 'failure'])
export type ReactorUnitStatus = z.infer<typeof ReactorUnitStatus>

export const ReactorCheckpointStatus = z.enum(['queued', 'running', 'success', 'failure', 'skipped'])
export type ReactorCheckpointStatus = z.infer<typeof ReactorCheckpointStatus>

export const ReactorPassStatus = z.enum(['dispatched', 'running', 'completed', 'throttled'])
export type ReactorPassStatus = z.infer<typeof ReactorPassStatus>

/**
 * Per-unit dispatch entry inside a reactor pass. The reactor walks
 * units sequentially; entries move through the status chain
 * `queued → running → success | failure`. Each entry carries the
 * `SkillRunId` so Studio can deep-link to the run's transcript.
 */
export const ReactorPassUnit = z.object({
  path: z.string().min(1),
  status: ReactorUnitStatus,
  skillRunId: SkillRunId.optional(),
  startedAt: Timestamp.optional(),
  completedAt: Timestamp.optional(),
  error: z.string().optional(),
})
export type ReactorPassUnit = z.infer<typeof ReactorPassUnit>

/**
 * Cross-unit checkpoint inside a reactor pass. Status `skipped`
 * indicates the loop reached the checkpoint phase but the ontology
 * either had no checkpoint binding or no per-unit dispatch succeeded.
 */
export const ReactorPassCheckpoint = z.object({
  skillId: SkillId,
  status: ReactorCheckpointStatus,
  skillRunId: SkillRunId.optional(),
  startedAt: Timestamp.optional(),
  completedAt: Timestamp.optional(),
  error: z.string().optional(),
})
export type ReactorPassCheckpoint = z.infer<typeof ReactorPassCheckpoint>

/**
 * One reactor pass record. Persisted at every state transition so
 * Studio's Activity page can render the live pass while it runs and
 * historical passes after they finish. Throttled passes carry no
 * units (the throttle decision is made before the unit list is built).
 */
export const ReactorPass = z.object({
  id: ReactorPassId,
  workspaceId: WorkspaceId,
  sourceId: SourceId,
  startedAt: Timestamp,
  completedAt: Timestamp.optional(),
  status: ReactorPassStatus,
  units: z.array(ReactorPassUnit).default([]),
  checkpoint: ReactorPassCheckpoint.optional(),
  /**
   * Why the pass was dropped, when `status === 'throttled'`. Free-form
   * so the receiver can include the cap value or any future reasons
   * the reactor learns to skip on.
   */
  throttledReason: z.string().optional(),
})
export type ReactorPass = z.infer<typeof ReactorPass>
