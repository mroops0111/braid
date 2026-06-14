import { z } from 'zod'
import { ClarifyTicketId, ProposalId, SkillId, SkillRunId, SourceId, Timestamp, WorkspaceId } from './common.js'

export const PlanUnitId = z.string().min(1).brand<'PlanUnitId'>()
export type PlanUnitId = z.infer<typeof PlanUnitId>

export const BatchPlanId = z.string().min(1).brand<'BatchPlanId'>()
export type BatchPlanId = z.infer<typeof BatchPlanId>

export const UnitStatus = z.enum(['pending', 'running', 'completed', 'failed', 'skipped'])
export type UnitStatus = z.infer<typeof UnitStatus>

export const BatchStatus = z.enum(['idle', 'deriving', 'running', 'completed', 'failed', 'stopped', 'archived'])
export type BatchStatus = z.infer<typeof BatchStatus>

// `intent` walks each intent source directly. `derive` first runs the
// ontology's `deriveUnits` skill to populate the unit list from a
// code-only workspace.
export const BatchInputMode = z.enum(['intent', 'derive'])
export type BatchInputMode = z.infer<typeof BatchInputMode>

export const PlanUnit = z.object({
  id: PlanUnitId,
  name: z.string().min(1),
  description: z.string(),
  // Source this unit was derived from (mode='intent' = the intent source it belongs to).
  // Omitted in mode='derive' because units come from the ontology's discovery skill.
  sourceId: SourceId.optional(),
  // What to pass to braid-extract as scope-hint. For intent mode this is the
  // doc / folder name within the source (e.g. "TSK00010 文字欄位.../"); empty
  // falls back to `name`.
  scopeHint: z.string().optional(),
  status: UnitStatus,
  // Stamped at startUnit so the UI can replay the skill log for completed / failed units.
  skillRunId: SkillRunId.optional(),
  startedAt: Timestamp.optional(),
  completedAt: Timestamp.optional(),
  proposalIds: z.array(ProposalId).default([]),
  clarifyTicketIds: z.array(ClarifyTicketId).default([]),
  error: z.string().optional(),
})
export type PlanUnit = z.infer<typeof PlanUnit>

export const BatchRunning = z.object({
  unitId: PlanUnitId,
  skillRunId: SkillRunId,
})
export type BatchRunning = z.infer<typeof BatchRunning>

export const BatchCheckpointPhaseStatus = z.enum(['running', 'completed', 'failed'])
export type BatchCheckpointPhaseStatus = z.infer<typeof BatchCheckpointPhaseStatus>

/**
 * One execution of the ontology-provided checkpoint skill. Append-only
 * inside `BatchPlan.checkpointPhases`; `unitIds` records which units
 * this run consumed so chunk accounting knows what's still pending.
 */
export const BatchCheckpointPhase = z.object({
  status: BatchCheckpointPhaseStatus,
  unitIds: z.array(PlanUnitId),
  startedAt: Timestamp.optional(),
  completedAt: Timestamp.optional(),
  skillRunId: SkillRunId.optional(),
  error: z.string().optional(),
})
export type BatchCheckpointPhase = z.infer<typeof BatchCheckpointPhase>

export const BatchPlan = z.object({
  id: BatchPlanId,
  workspaceId: WorkspaceId,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  mode: BatchInputMode,
  status: BatchStatus,
  autoApply: z.boolean(),
  // The git tag created at start so a botched batch can be rolled back via Restore.
  baselineTag: z.string().optional(),
  units: z.array(PlanUnit),
  running: BatchRunning.optional(),
  error: z.string().optional(),
  /**
   * Append-only history of checkpoint skill runs. Failed phases are
   * dropped by `resumeRun` so a re-run starts chunk accounting fresh.
   */
  checkpointPhases: z.array(BatchCheckpointPhase).default([]),
  /**
   * Frozen snapshot of the ontology's batch binding taken at start().
   * UI reads it to label steps and pre-split anticipated chunks;
   * resume reads it so chunk accounting survives ontology config
   * changes mid-plan.
   */
  batchPolicy: z.object({
    perUnitSkillId: SkillId,
    perUnitLabel: z.string().optional(),
    checkpointSkillId: SkillId.optional(),
    checkpointLabel: z.string().optional(),
    checkpointChunkSize: z.number().int().positive().optional(),
    checkpointRunAtEnd: z.boolean().optional(),
  }).optional(),
})
export type BatchPlan = z.infer<typeof BatchPlan>
