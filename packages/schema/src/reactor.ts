import { z } from 'zod'
import { SkillId, SkillRunId, SourceId, Timestamp, WorkspaceId } from './common.js'

// One event-driven cycle: diff the source, dispatch per changed unit, then checkpoint.
export const ReactorCycleId = z.string().min(1).brand<'ReactorCycleId'>()
export type ReactorCycleId = z.infer<typeof ReactorCycleId>

export const ReactorUnitStatus = z.enum(['queued', 'running', 'success', 'failure'])
export type ReactorUnitStatus = z.infer<typeof ReactorUnitStatus>

export const ReactorCheckpointStatus = z.enum(['queued', 'running', 'success', 'failure', 'skipped'])
export type ReactorCheckpointStatus = z.infer<typeof ReactorCheckpointStatus>

export const ReactorCycleStatus = z.enum(['dispatched', 'running', 'completed', 'throttled'])
export type ReactorCycleStatus = z.infer<typeof ReactorCycleStatus>

// One unit's dispatch. skillRunId lets Studio deep-link to the transcript.
export const ReactorUnit = z.object({
  path: z.string().min(1),
  status: ReactorUnitStatus,
  skillRunId: SkillRunId.optional(),
  startedAt: Timestamp.optional(),
  completedAt: Timestamp.optional(),
  error: z.string().optional(),
})
export type ReactorUnit = z.infer<typeof ReactorUnit>

// Cross-unit checkpoint. 'skipped' = no checkpoint binding, or no unit succeeded.
export const ReactorCheckpoint = z.object({
  skillId: SkillId,
  status: ReactorCheckpointStatus,
  skillRunId: SkillRunId.optional(),
  startedAt: Timestamp.optional(),
  completedAt: Timestamp.optional(),
  error: z.string().optional(),
})
export type ReactorCheckpoint = z.infer<typeof ReactorCheckpoint>

// Persisted at every state transition so Studio renders live and past cycles.
// Throttled cycles carry no units, decided before the unit list is built.
export const ReactorCycle = z.object({
  id: ReactorCycleId,
  workspaceId: WorkspaceId,
  sourceId: SourceId,
  startedAt: Timestamp,
  completedAt: Timestamp.optional(),
  status: ReactorCycleStatus,
  units: z.array(ReactorUnit).default([]),
  checkpoint: ReactorCheckpoint.optional(),
  // Why a throttled cycle was dropped. Free-form, may carry the cap value.
  throttledReason: z.string().optional(),
})
export type ReactorCycle = z.infer<typeof ReactorCycle>
