import { z } from 'zod'
import { BatchInputMode, BatchPlanId, BatchUnitId } from './batch.js'
import { ClarificationId, CommitSha, ProposalId, SkillId, SkillRunId, SourceId, WorkspaceId } from './common.js'
import { ReactorCycleId } from './reactor.js'

// Workspace-scoped runtime notifications, the SSE contract between server and Studio.
// Studio's useWorkspaceEvents hook reads these to invalidate react-query caches the moment
// a server mutation happens. NOT persisted, NOT replayable, a restart drops anything in flight.
// Keep payloads small, only the identifiers a subscriber needs to pick which query keys to drop.
// Events are signals, not deliveries, the fresh value lives behind the list and detail endpoints.

// The envelope every event carries. Each type below extends it with its own fields.
const WorkspaceEventBase = z.object({
  workspaceId: WorkspaceId,
  at: z.string(),
})

export const RunStartedEvent = WorkspaceEventBase.extend({
  type: z.literal('run.started'),
  runId: SkillRunId,
  skillId: z.string(),
})
export type RunStartedEvent = z.infer<typeof RunStartedEvent>

export const RunCompletedEvent = WorkspaceEventBase.extend({
  type: z.literal('run.completed'),
  runId: SkillRunId,
  skillId: z.string(),
  outcome: z.enum(['success', 'error', 'cancelled']),
})
export type RunCompletedEvent = z.infer<typeof RunCompletedEvent>

export const ProposalCreatedEvent = WorkspaceEventBase.extend({
  type: z.literal('proposal.created'),
  proposalId: ProposalId,
})
export type ProposalCreatedEvent = z.infer<typeof ProposalCreatedEvent>

export const ProposalAppliedEvent = WorkspaceEventBase.extend({
  type: z.literal('proposal.applied'),
  proposalId: ProposalId,
})
export type ProposalAppliedEvent = z.infer<typeof ProposalAppliedEvent>

export const ProposalRejectedEvent = WorkspaceEventBase.extend({
  type: z.literal('proposal.rejected'),
  proposalId: ProposalId,
})
export type ProposalRejectedEvent = z.infer<typeof ProposalRejectedEvent>

export const ClarificationCreatedEvent = WorkspaceEventBase.extend({
  type: z.literal('clarification.created'),
  clarificationId: ClarificationId,
})
export type ClarificationCreatedEvent = z.infer<typeof ClarificationCreatedEvent>

export const ClarificationAnsweredEvent = WorkspaceEventBase.extend({
  type: z.literal('clarification.answered'),
  clarificationId: ClarificationId,
})
export type ClarificationAnsweredEvent = z.infer<typeof ClarificationAnsweredEvent>

export const ClarificationAppliedEvent = WorkspaceEventBase.extend({
  type: z.literal('clarification.applied'),
  clarificationId: ClarificationId,
  proposalId: ProposalId.optional(),
})
export type ClarificationAppliedEvent = z.infer<typeof ClarificationAppliedEvent>

export const ClarificationSkippedEvent = WorkspaceEventBase.extend({
  type: z.literal('clarification.skipped'),
  clarificationId: ClarificationId,
})
export type ClarificationSkippedEvent = z.infer<typeof ClarificationSkippedEvent>

export const SourceSyncedEvent = WorkspaceEventBase.extend({
  type: z.literal('source.synced'),
  sourceId: SourceId,
  changed: z.boolean(),
})
export type SourceSyncedEvent = z.infer<typeof SourceSyncedEvent>

export const HistoryCommittedEvent = WorkspaceEventBase.extend({
  type: z.literal('history.committed'),
  sha: CommitSha,
})
export type HistoryCommittedEvent = z.infer<typeof HistoryCommittedEvent>

export const WorkspaceRestoredEvent = WorkspaceEventBase.extend({
  type: z.literal('workspace.restored'),
  restoredTo: CommitSha,
  newCommit: CommitSha,
})
export type WorkspaceRestoredEvent = z.infer<typeof WorkspaceRestoredEvent>

/**
 * A rebuild is under way, so a search covers less than the whole graph.
 * Vectors are an index rather than part of the model,
 * so a restored workspace answers structurally from the first moment,
 * and gains semantic search as these events run their course.
 */
export const EmbeddingStartedEvent = WorkspaceEventBase.extend({
  type: z.literal('embedding.started'),
  total: z.number().int().nonnegative(),
})
export type EmbeddingStartedEvent = z.infer<typeof EmbeddingStartedEvent>

export const EmbeddingProgressEvent = WorkspaceEventBase.extend({
  type: z.literal('embedding.progress'),
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
})
export type EmbeddingProgressEvent = z.infer<typeof EmbeddingProgressEvent>

export const EmbeddingCompletedEvent = WorkspaceEventBase.extend({
  type: z.literal('embedding.completed'),
  total: z.number().int().nonnegative(),
})
export type EmbeddingCompletedEvent = z.infer<typeof EmbeddingCompletedEvent>

export const EmbeddingFailedEvent = WorkspaceEventBase.extend({
  type: z.literal('embedding.failed'),
  message: z.string().min(1),
})
export type EmbeddingFailedEvent = z.infer<typeof EmbeddingFailedEvent>

export const BatchStartedEvent = WorkspaceEventBase.extend({
  type: z.literal('batch.started'),
  planId: BatchPlanId,
  mode: BatchInputMode,
})
export type BatchStartedEvent = z.infer<typeof BatchStartedEvent>

export const BatchUnitStartedEvent = WorkspaceEventBase.extend({
  type: z.literal('batch.unit.started'),
  planId: BatchPlanId,
  unitId: BatchUnitId,
  unitName: z.string(),
})
export type BatchUnitStartedEvent = z.infer<typeof BatchUnitStartedEvent>

export const BatchUnitCompletedEvent = WorkspaceEventBase.extend({
  type: z.literal('batch.unit.completed'),
  planId: BatchPlanId,
  unitId: BatchUnitId,
  applied: z.number(),
  queued: z.number(),
})
export type BatchUnitCompletedEvent = z.infer<typeof BatchUnitCompletedEvent>

export const BatchUnitFailedEvent = WorkspaceEventBase.extend({
  type: z.literal('batch.unit.failed'),
  planId: BatchPlanId,
  unitId: BatchUnitId,
  error: z.string(),
})
export type BatchUnitFailedEvent = z.infer<typeof BatchUnitFailedEvent>

export const BatchCompletedEvent = WorkspaceEventBase.extend({
  type: z.literal('batch.completed'),
  planId: BatchPlanId,
})
export type BatchCompletedEvent = z.infer<typeof BatchCompletedEvent>

export const BatchStoppedEvent = WorkspaceEventBase.extend({
  type: z.literal('batch.stopped'),
  planId: BatchPlanId,
})
export type BatchStoppedEvent = z.infer<typeof BatchStoppedEvent>

export const BatchFailedEvent = WorkspaceEventBase.extend({
  type: z.literal('batch.failed'),
  planId: BatchPlanId,
  error: z.string(),
})
export type BatchFailedEvent = z.infer<typeof BatchFailedEvent>

export const BatchCheckpointStartedEvent = WorkspaceEventBase.extend({
  type: z.literal('batch.checkpoint.started'),
  planId: BatchPlanId,
  skillRunId: SkillRunId,
})
export type BatchCheckpointStartedEvent = z.infer<typeof BatchCheckpointStartedEvent>

export const BatchCheckpointCompletedEvent = WorkspaceEventBase.extend({
  type: z.literal('batch.checkpoint.completed'),
  planId: BatchPlanId,
  skillRunId: SkillRunId,
})
export type BatchCheckpointCompletedEvent = z.infer<typeof BatchCheckpointCompletedEvent>

export const BatchCheckpointFailedEvent = WorkspaceEventBase.extend({
  type: z.literal('batch.checkpoint.failed'),
  planId: BatchPlanId,
  skillRunId: SkillRunId,
  error: z.string(),
})
export type BatchCheckpointFailedEvent = z.infer<typeof BatchCheckpointFailedEvent>

/**
 * Reactor finished partitioning a synced source, about to dispatch per-unit runs sequentially.
 * totalUnits is the count of new plus changed units. cycleId keys into the ReactorCycle record.
 */
export const ReactorDispatchedEvent = WorkspaceEventBase.extend({
  type: z.literal('reactor.dispatched'),
  cycleId: ReactorCycleId,
  sourceId: SourceId,
  totalUnits: z.number(),
})
export type ReactorDispatchedEvent = z.infer<typeof ReactorDispatchedEvent>

/**
 * The full reactor cycle is over. checkpointRan distinguishes the "0 changed units,
 * no checkpoint needed" case from the normal flow.
 */
export const ReactorCompletedEvent = WorkspaceEventBase.extend({
  type: z.literal('reactor.completed'),
  cycleId: ReactorCycleId,
  sourceId: SourceId,
  totalUnits: z.number(),
  checkpointRan: z.boolean(),
})
export type ReactorCompletedEvent = z.infer<typeof ReactorCompletedEvent>

/**
 * Reactor refused to dispatch, the rolling 1h window already hit maxRunsPerHour.
 * The triggering source.synced is acknowledged and dropped.
 */
export const ReactorThrottledEvent = WorkspaceEventBase.extend({
  type: z.literal('reactor.throttled'),
  cycleId: ReactorCycleId,
  sourceId: SourceId,
  limit: z.number(),
})
export type ReactorThrottledEvent = z.infer<typeof ReactorThrottledEvent>

/** Per-unit start signal. processed/total render the "3/15" progress text. */
export const ReactorUnitStartedEvent = WorkspaceEventBase.extend({
  type: z.literal('reactor.unit.started'),
  cycleId: ReactorCycleId,
  unitPath: z.string(),
  skillRunId: SkillRunId,
  processed: z.number(),
  total: z.number(),
})
export type ReactorUnitStartedEvent = z.infer<typeof ReactorUnitStartedEvent>

/** Per-unit completion. A failure does NOT abort the loop, the next unit still starts. */
export const ReactorUnitCompletedEvent = WorkspaceEventBase.extend({
  type: z.literal('reactor.unit.completed'),
  cycleId: ReactorCycleId,
  unitPath: z.string(),
  status: z.enum(['success', 'failure']),
  processed: z.number(),
  total: z.number(),
})
export type ReactorUnitCompletedEvent = z.infer<typeof ReactorUnitCompletedEvent>

/**
 * Checkpoint skill about to start, fires only when at least one per-unit dispatch succeeded
 * and the ontology declares a checkpoint binding.
 */
export const ReactorCheckpointStartedEvent = WorkspaceEventBase.extend({
  type: z.literal('reactor.checkpoint.started'),
  cycleId: ReactorCycleId,
  skillId: SkillId,
  skillRunId: SkillRunId,
})
export type ReactorCheckpointStartedEvent = z.infer<typeof ReactorCheckpointStartedEvent>

/**
 * Checkpoint skill finished. status='skipped' means the cycle chose not to run the checkpoint,
 * kept so the Activity timeline always has a terminal entry for the checkpoint row.
 */
export const ReactorCheckpointCompletedEvent = WorkspaceEventBase.extend({
  type: z.literal('reactor.checkpoint.completed'),
  cycleId: ReactorCycleId,
  status: z.enum(['success', 'failure', 'skipped']),
})
export type ReactorCheckpointCompletedEvent = z.infer<typeof ReactorCheckpointCompletedEvent>

export const WorkspaceEvent = z.discriminatedUnion('type', [
  EmbeddingStartedEvent,
  EmbeddingProgressEvent,
  EmbeddingCompletedEvent,
  EmbeddingFailedEvent,
  RunStartedEvent,
  RunCompletedEvent,
  ProposalCreatedEvent,
  ProposalAppliedEvent,
  ProposalRejectedEvent,
  ClarificationCreatedEvent,
  ClarificationAnsweredEvent,
  ClarificationAppliedEvent,
  ClarificationSkippedEvent,
  SourceSyncedEvent,
  HistoryCommittedEvent,
  WorkspaceRestoredEvent,
  BatchStartedEvent,
  BatchUnitStartedEvent,
  BatchUnitCompletedEvent,
  BatchUnitFailedEvent,
  BatchCompletedEvent,
  BatchStoppedEvent,
  BatchFailedEvent,
  BatchCheckpointStartedEvent,
  BatchCheckpointCompletedEvent,
  BatchCheckpointFailedEvent,
  ReactorDispatchedEvent,
  ReactorCompletedEvent,
  ReactorThrottledEvent,
  ReactorUnitStartedEvent,
  ReactorUnitCompletedEvent,
  ReactorCheckpointStartedEvent,
  ReactorCheckpointCompletedEvent,
])
export type WorkspaceEvent = z.infer<typeof WorkspaceEvent>

export type WorkspaceEventType = WorkspaceEvent['type']
