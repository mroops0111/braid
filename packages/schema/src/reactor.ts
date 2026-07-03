import { z } from 'zod'
import { SkillId, SkillRunId, SourceId, Timestamp, WorkspaceId } from './common.js'

// One event-driven pass: diff the source, dispatch per changed unit, then checkpoint.
export const ReactorPassId = z.string().min(1).brand<'ReactorPassId'>()
export type ReactorPassId = z.infer<typeof ReactorPassId>

export const ReactorUnitStatus = z.enum(['queued', 'running', 'success', 'failure'])
export type ReactorUnitStatus = z.infer<typeof ReactorUnitStatus>

export const ReactorCheckpointStatus = z.enum(['queued', 'running', 'success', 'failure', 'skipped'])
export type ReactorCheckpointStatus = z.infer<typeof ReactorCheckpointStatus>

export const ReactorPassStatus = z.enum(['dispatched', 'running', 'completed', 'throttled'])
export type ReactorPassStatus = z.infer<typeof ReactorPassStatus>

// One unit's dispatch. skillRunId lets Studio deep-link to the transcript.
export const ReactorPassUnit = z.object({
  path: z.string().min(1),
  status: ReactorUnitStatus,
  skillRunId: SkillRunId.optional(),
  startedAt: Timestamp.optional(),
  completedAt: Timestamp.optional(),
  error: z.string().optional(),
})
export type ReactorPassUnit = z.infer<typeof ReactorPassUnit>

// Cross-unit checkpoint. 'skipped' = no checkpoint binding, or no unit succeeded.
export const ReactorPassCheckpoint = z.object({
  skillId: SkillId,
  status: ReactorCheckpointStatus,
  skillRunId: SkillRunId.optional(),
  startedAt: Timestamp.optional(),
  completedAt: Timestamp.optional(),
  error: z.string().optional(),
})
export type ReactorPassCheckpoint = z.infer<typeof ReactorPassCheckpoint>

// Persisted at every state transition so Studio renders live and past passes.
// Throttled passes carry no units, decided before the unit list is built.
export const ReactorPass = z.object({
  id: ReactorPassId,
  workspaceId: WorkspaceId,
  sourceId: SourceId,
  startedAt: Timestamp,
  completedAt: Timestamp.optional(),
  status: ReactorPassStatus,
  units: z.array(ReactorPassUnit).default([]),
  checkpoint: ReactorPassCheckpoint.optional(),
  // Why a throttled pass was dropped. Free-form, may carry the cap value.
  throttledReason: z.string().optional(),
})
export type ReactorPass = z.infer<typeof ReactorPass>
