import { z } from 'zod'
import { ClarifyTicketId, ProposalId, SkillRunId, SourceId, Timestamp, WorkspaceId } from './common.js'

export const PlanUnitId = z.string().min(1).brand<'PlanUnitId'>()
export type PlanUnitId = z.infer<typeof PlanUnitId>

export const BatchPlanId = z.string().min(1).brand<'BatchPlanId'>()
export type BatchPlanId = z.infer<typeof BatchPlanId>

export const UnitStatus = z.enum(['pending', 'running', 'completed', 'failed', 'skipped'])
export type UnitStatus = z.infer<typeof UnitStatus>

export const BatchStatus = z.enum(['idle', 'scanning', 'running', 'completed', 'failed', 'stopped', 'archived'])
export type BatchStatus = z.infer<typeof BatchStatus>

// `intent` walks each intent source directly. `scan` runs braid-scan first to
// derive units from a codebase when no intent docs exist.
export const BatchInputMode = z.enum(['intent', 'scan'])
export type BatchInputMode = z.infer<typeof BatchInputMode>

export const PlanUnit = z.object({
  id: PlanUnitId,
  name: z.string().min(1),
  description: z.string(),
  // Source this unit was derived from (mode='intent' = the intent source it belongs to).
  // Omitted in mode='scan' because units come from the scanner's business-area decomposition.
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
})
export type BatchPlan = z.infer<typeof BatchPlan>
