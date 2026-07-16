import { z } from 'zod'
import { BatchInputMode, BatchPlanId, BatchUnitId } from './batch.js'
import { ClarifyTicketId, CommitSha, ProposalId, SkillId, SkillRunId, SourceId, WorkspaceId } from './common.js'
import { ReactorCycleId } from './reactor.js'

// Workspace-scoped runtime notifications, the SSE contract between server and Studio.
// Studio's useWorkspaceEvents hook reads these to invalidate react-query caches the moment
// a server mutation happens. NOT persisted, NOT replayable, a restart drops anything in flight.
// Keep payloads small, only the identifiers a subscriber needs to pick which query keys to drop.
// Events are signals, not deliveries, the fresh value lives behind the list and detail endpoints.

export const RunStartedEvent = z.object({
  type: z.literal('run.started'),
  workspaceId: WorkspaceId,
  runId: SkillRunId,
  skillId: z.string(),
  at: z.string(),
})
export type RunStartedEvent = z.infer<typeof RunStartedEvent>

export const RunCompletedEvent = z.object({
  type: z.literal('run.completed'),
  workspaceId: WorkspaceId,
  runId: SkillRunId,
  skillId: z.string(),
  outcome: z.enum(['success', 'error', 'cancelled']),
  at: z.string(),
})
export type RunCompletedEvent = z.infer<typeof RunCompletedEvent>

export const ProposalCreatedEvent = z.object({
  type: z.literal('proposal.created'),
  workspaceId: WorkspaceId,
  proposalId: ProposalId,
  at: z.string(),
})
export type ProposalCreatedEvent = z.infer<typeof ProposalCreatedEvent>

export const ProposalAppliedEvent = z.object({
  type: z.literal('proposal.applied'),
  workspaceId: WorkspaceId,
  proposalId: ProposalId,
  at: z.string(),
})
export type ProposalAppliedEvent = z.infer<typeof ProposalAppliedEvent>

export const ProposalRejectedEvent = z.object({
  type: z.literal('proposal.rejected'),
  workspaceId: WorkspaceId,
  proposalId: ProposalId,
  at: z.string(),
})
export type ProposalRejectedEvent = z.infer<typeof ProposalRejectedEvent>

export const ClarifyCreatedEvent = z.object({
  type: z.literal('clarify.created'),
  workspaceId: WorkspaceId,
  ticketId: ClarifyTicketId,
  at: z.string(),
})
export type ClarifyCreatedEvent = z.infer<typeof ClarifyCreatedEvent>

export const ClarifyAnsweredEvent = z.object({
  type: z.literal('clarify.answered'),
  workspaceId: WorkspaceId,
  ticketId: ClarifyTicketId,
  at: z.string(),
})
export type ClarifyAnsweredEvent = z.infer<typeof ClarifyAnsweredEvent>

export const ClarifyAppliedEvent = z.object({
  type: z.literal('clarify.applied'),
  workspaceId: WorkspaceId,
  ticketId: ClarifyTicketId,
  proposalId: ProposalId.optional(),
  at: z.string(),
})
export type ClarifyAppliedEvent = z.infer<typeof ClarifyAppliedEvent>

export const ClarifySkippedEvent = z.object({
  type: z.literal('clarify.skipped'),
  workspaceId: WorkspaceId,
  ticketId: ClarifyTicketId,
  at: z.string(),
})
export type ClarifySkippedEvent = z.infer<typeof ClarifySkippedEvent>

export const SourceSyncedEvent = z.object({
  type: z.literal('source.synced'),
  workspaceId: WorkspaceId,
  sourceId: SourceId,
  changed: z.boolean(),
  at: z.string(),
})
export type SourceSyncedEvent = z.infer<typeof SourceSyncedEvent>

export const HistoryCommittedEvent = z.object({
  type: z.literal('history.committed'),
  workspaceId: WorkspaceId,
  sha: CommitSha,
  at: z.string(),
})
export type HistoryCommittedEvent = z.infer<typeof HistoryCommittedEvent>

export const WorkspaceRestoredEvent = z.object({
  type: z.literal('workspace.restored'),
  workspaceId: WorkspaceId,
  restoredTo: CommitSha,
  newCommit: CommitSha,
  at: z.string(),
})
export type WorkspaceRestoredEvent = z.infer<typeof WorkspaceRestoredEvent>

export const BatchStartedEvent = z.object({
  type: z.literal('batch.started'),
  workspaceId: WorkspaceId,
  planId: BatchPlanId,
  mode: BatchInputMode,
  at: z.string(),
})
export type BatchStartedEvent = z.infer<typeof BatchStartedEvent>

export const BatchUnitStartedEvent = z.object({
  type: z.literal('batch.unit.started'),
  workspaceId: WorkspaceId,
  planId: BatchPlanId,
  unitId: BatchUnitId,
  unitName: z.string(),
  at: z.string(),
})
export type BatchUnitStartedEvent = z.infer<typeof BatchUnitStartedEvent>

export const BatchUnitCompletedEvent = z.object({
  type: z.literal('batch.unit.completed'),
  workspaceId: WorkspaceId,
  planId: BatchPlanId,
  unitId: BatchUnitId,
  applied: z.number(),
  queued: z.number(),
  at: z.string(),
})
export type BatchUnitCompletedEvent = z.infer<typeof BatchUnitCompletedEvent>

export const BatchUnitFailedEvent = z.object({
  type: z.literal('batch.unit.failed'),
  workspaceId: WorkspaceId,
  planId: BatchPlanId,
  unitId: BatchUnitId,
  error: z.string(),
  at: z.string(),
})
export type BatchUnitFailedEvent = z.infer<typeof BatchUnitFailedEvent>

export const BatchCompletedEvent = z.object({
  type: z.literal('batch.completed'),
  workspaceId: WorkspaceId,
  planId: BatchPlanId,
  at: z.string(),
})
export type BatchCompletedEvent = z.infer<typeof BatchCompletedEvent>

export const BatchStoppedEvent = z.object({
  type: z.literal('batch.stopped'),
  workspaceId: WorkspaceId,
  planId: BatchPlanId,
  at: z.string(),
})
export type BatchStoppedEvent = z.infer<typeof BatchStoppedEvent>

export const BatchFailedEvent = z.object({
  type: z.literal('batch.failed'),
  workspaceId: WorkspaceId,
  planId: BatchPlanId,
  error: z.string(),
  at: z.string(),
})
export type BatchFailedEvent = z.infer<typeof BatchFailedEvent>

export const BatchCheckpointStartedEvent = z.object({
  type: z.literal('batch.checkpoint.started'),
  workspaceId: WorkspaceId,
  planId: BatchPlanId,
  skillRunId: SkillRunId,
  at: z.string(),
})
export type BatchCheckpointStartedEvent = z.infer<typeof BatchCheckpointStartedEvent>

export const BatchCheckpointCompletedEvent = z.object({
  type: z.literal('batch.checkpoint.completed'),
  workspaceId: WorkspaceId,
  planId: BatchPlanId,
  skillRunId: SkillRunId,
  at: z.string(),
})
export type BatchCheckpointCompletedEvent = z.infer<typeof BatchCheckpointCompletedEvent>

export const BatchCheckpointFailedEvent = z.object({
  type: z.literal('batch.checkpoint.failed'),
  workspaceId: WorkspaceId,
  planId: BatchPlanId,
  skillRunId: SkillRunId,
  error: z.string(),
  at: z.string(),
})
export type BatchCheckpointFailedEvent = z.infer<typeof BatchCheckpointFailedEvent>

// Reactor finished partitioning a synced source, about to dispatch per-unit runs sequentially.
// totalUnits is the count of new plus changed units. cycleId keys into the ReactorCycle record.
export const ReactorDispatchedEvent = z.object({
  type: z.literal('reactor.dispatched'),
  workspaceId: WorkspaceId,
  cycleId: ReactorCycleId,
  sourceId: SourceId,
  totalUnits: z.number(),
  at: z.string(),
})
export type ReactorDispatchedEvent = z.infer<typeof ReactorDispatchedEvent>

// The full reactor cycle is over. checkpointRan distinguishes the "0 changed units,
// no checkpoint needed" case from the normal flow.
export const ReactorCompletedEvent = z.object({
  type: z.literal('reactor.completed'),
  workspaceId: WorkspaceId,
  cycleId: ReactorCycleId,
  sourceId: SourceId,
  totalUnits: z.number(),
  checkpointRan: z.boolean(),
  at: z.string(),
})
export type ReactorCompletedEvent = z.infer<typeof ReactorCompletedEvent>

// Reactor refused to dispatch, the rolling 1h window already hit maxRunsPerHour.
// The triggering source.synced is acknowledged and dropped.
export const ReactorThrottledEvent = z.object({
  type: z.literal('reactor.throttled'),
  workspaceId: WorkspaceId,
  cycleId: ReactorCycleId,
  sourceId: SourceId,
  limit: z.number(),
  at: z.string(),
})
export type ReactorThrottledEvent = z.infer<typeof ReactorThrottledEvent>

// Per-unit start signal. processed/total render the "3/15" progress text.
export const ReactorUnitStartedEvent = z.object({
  type: z.literal('reactor.unit.started'),
  workspaceId: WorkspaceId,
  cycleId: ReactorCycleId,
  unitPath: z.string(),
  skillRunId: SkillRunId,
  processed: z.number(),
  total: z.number(),
  at: z.string(),
})
export type ReactorUnitStartedEvent = z.infer<typeof ReactorUnitStartedEvent>

// Per-unit completion. A failure does NOT abort the loop, the next unit still starts.
export const ReactorUnitCompletedEvent = z.object({
  type: z.literal('reactor.unit.completed'),
  workspaceId: WorkspaceId,
  cycleId: ReactorCycleId,
  unitPath: z.string(),
  status: z.enum(['success', 'failure']),
  processed: z.number(),
  total: z.number(),
  at: z.string(),
})
export type ReactorUnitCompletedEvent = z.infer<typeof ReactorUnitCompletedEvent>

// Checkpoint skill about to start, fires only when at least one per-unit dispatch succeeded
// and the ontology declares a checkpoint binding.
export const ReactorCheckpointStartedEvent = z.object({
  type: z.literal('reactor.checkpoint.started'),
  workspaceId: WorkspaceId,
  cycleId: ReactorCycleId,
  skillId: SkillId,
  skillRunId: SkillRunId,
  at: z.string(),
})
export type ReactorCheckpointStartedEvent = z.infer<typeof ReactorCheckpointStartedEvent>

// Checkpoint skill finished. status='skipped' means the cycle chose not to run the checkpoint,
// kept so the Activity timeline always has a terminal entry for the checkpoint row.
export const ReactorCheckpointCompletedEvent = z.object({
  type: z.literal('reactor.checkpoint.completed'),
  workspaceId: WorkspaceId,
  cycleId: ReactorCycleId,
  status: z.enum(['success', 'failure', 'skipped']),
  at: z.string(),
})
export type ReactorCheckpointCompletedEvent = z.infer<typeof ReactorCheckpointCompletedEvent>

export const WorkspaceEvent = z.discriminatedUnion('type', [
  RunStartedEvent,
  RunCompletedEvent,
  ProposalCreatedEvent,
  ProposalAppliedEvent,
  ProposalRejectedEvent,
  ClarifyCreatedEvent,
  ClarifyAnsweredEvent,
  ClarifyAppliedEvent,
  ClarifySkippedEvent,
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
