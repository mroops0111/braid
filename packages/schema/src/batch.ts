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

// intent mode walks intent sources directly. derive mode seeds units via the ontology's deriveUnits skill,
// for code-only workspaces.
export const BatchInputMode = z.enum(['intent', 'derive'])
export type BatchInputMode = z.infer<typeof BatchInputMode>

export const PlanUnit = z.object({
  id: PlanUnitId,
  name: z.string().min(1),
  description: z.string(),
  // The intent source this unit belongs to. Absent in derive mode.
  sourceId: SourceId.optional(),
  // Scope hint for braid-extract (doc/folder name). Empty falls back to name.
  scopeHint: z.string().optional(),
  status: UnitStatus,
  // Stamped at startUnit so the UI can replay the run's log.
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

// unitIds records which units this run consumed, for chunk accounting.
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
  // Git tag from start(), lets Restore roll back a botched batch.
  baselineTag: z.string().optional(),
  units: z.array(PlanUnit),
  running: BatchRunning.optional(),
  error: z.string().optional(),
  // resumeRun drops failed phases so a re-run starts accounting fresh.
  checkpointPhases: z.array(BatchCheckpointPhase).default([]),
  // Frozen at start() so accounting survives ontology config changes mid-plan.
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
