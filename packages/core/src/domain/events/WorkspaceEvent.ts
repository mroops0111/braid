import type {
  BatchInputMode,
  BatchPlanId,
  ClarifyTicketId,
  CommitSha,
  PlanUnitId,
  ProposalId,
  ReactorCycleId,
  SkillId,
  SkillRunId,
  SourceId,
  WorkspaceId,
} from '@braidhq/schema'

/**
 * Workspace-scoped runtime notifications.
 * Pure transport for the Studio's `useWorkspaceEvents` hook,
 * to invalidate react-query caches the moment a server mutation happens.
 * NOT persisted. NOT replayable. Server restart drops anything in flight. Clients re-fetch on reconnect.
 *
 * Anything you'd otherwise have to "click refresh" for should fire here. Keep payloads small,
 * only the identifiers a subscriber needs to know which query keys to invalidate.
 * The fresh value lives behind the existing list / detail endpoints. Events are signals, not deliveries.
 */
export type WorkspaceEvent =
  | RunStartedEvent
  | RunCompletedEvent
  | ProposalCreatedEvent
  | ProposalAppliedEvent
  | ProposalRejectedEvent
  | ClarifyCreatedEvent
  | ClarifyAnsweredEvent
  | ClarifyAppliedEvent
  | ClarifySkippedEvent
  | SourceSyncedEvent
  | HistoryCommittedEvent
  | WorkspaceRestoredEvent
  | BatchStartedEvent
  | BatchUnitStartedEvent
  | BatchUnitCompletedEvent
  | BatchUnitFailedEvent
  | BatchCompletedEvent
  | BatchStoppedEvent
  | BatchFailedEvent
  | BatchCheckpointStartedEvent
  | BatchCheckpointCompletedEvent
  | BatchCheckpointFailedEvent
  | ReactorDispatchedEvent
  | ReactorCompletedEvent
  | ReactorThrottledEvent
  | ReactorUnitStartedEvent
  | ReactorUnitCompletedEvent
  | ReactorCheckpointStartedEvent
  | ReactorCheckpointCompletedEvent

export interface RunStartedEvent {
  readonly type: 'run.started'
  readonly workspaceId: WorkspaceId
  readonly runId: SkillRunId
  readonly skillId: string
  readonly at: string
}

export interface RunCompletedEvent {
  readonly type: 'run.completed'
  readonly workspaceId: WorkspaceId
  readonly runId: SkillRunId
  readonly skillId: string
  readonly outcome: 'success' | 'error' | 'cancelled'
  readonly at: string
}

export interface ProposalCreatedEvent {
  readonly type: 'proposal.created'
  readonly workspaceId: WorkspaceId
  readonly proposalId: ProposalId
  readonly at: string
}

export interface ProposalAppliedEvent {
  readonly type: 'proposal.applied'
  readonly workspaceId: WorkspaceId
  readonly proposalId: ProposalId
  readonly at: string
}

export interface ProposalRejectedEvent {
  readonly type: 'proposal.rejected'
  readonly workspaceId: WorkspaceId
  readonly proposalId: ProposalId
  readonly at: string
}

export interface ClarifyCreatedEvent {
  readonly type: 'clarify.created'
  readonly workspaceId: WorkspaceId
  readonly ticketId: ClarifyTicketId
  readonly at: string
}

export interface ClarifyAnsweredEvent {
  readonly type: 'clarify.answered'
  readonly workspaceId: WorkspaceId
  readonly ticketId: ClarifyTicketId
  readonly at: string
}

export interface ClarifyAppliedEvent {
  readonly type: 'clarify.applied'
  readonly workspaceId: WorkspaceId
  readonly ticketId: ClarifyTicketId
  readonly proposalId?: ProposalId
  readonly at: string
}

export interface ClarifySkippedEvent {
  readonly type: 'clarify.skipped'
  readonly workspaceId: WorkspaceId
  readonly ticketId: ClarifyTicketId
  readonly at: string
}

export interface SourceSyncedEvent {
  readonly type: 'source.synced'
  readonly workspaceId: WorkspaceId
  readonly sourceId: SourceId
  readonly changed: boolean
  readonly at: string
}

export interface HistoryCommittedEvent {
  readonly type: 'history.committed'
  readonly workspaceId: WorkspaceId
  readonly sha: CommitSha
  readonly at: string
}

export interface WorkspaceRestoredEvent {
  readonly type: 'workspace.restored'
  readonly workspaceId: WorkspaceId
  readonly restoredTo: CommitSha
  readonly newCommit: CommitSha
  readonly at: string
}

export interface BatchStartedEvent {
  readonly type: 'batch.started'
  readonly workspaceId: WorkspaceId
  readonly planId: BatchPlanId
  readonly mode: BatchInputMode
  readonly at: string
}

export interface BatchUnitStartedEvent {
  readonly type: 'batch.unit.started'
  readonly workspaceId: WorkspaceId
  readonly planId: BatchPlanId
  readonly unitId: PlanUnitId
  readonly unitName: string
  readonly at: string
}

export interface BatchUnitCompletedEvent {
  readonly type: 'batch.unit.completed'
  readonly workspaceId: WorkspaceId
  readonly planId: BatchPlanId
  readonly unitId: PlanUnitId
  readonly applied: number
  readonly queued: number
  readonly at: string
}

export interface BatchUnitFailedEvent {
  readonly type: 'batch.unit.failed'
  readonly workspaceId: WorkspaceId
  readonly planId: BatchPlanId
  readonly unitId: PlanUnitId
  readonly error: string
  readonly at: string
}

export interface BatchCompletedEvent {
  readonly type: 'batch.completed'
  readonly workspaceId: WorkspaceId
  readonly planId: BatchPlanId
  readonly at: string
}

export interface BatchStoppedEvent {
  readonly type: 'batch.stopped'
  readonly workspaceId: WorkspaceId
  readonly planId: BatchPlanId
  readonly at: string
}

export interface BatchFailedEvent {
  readonly type: 'batch.failed'
  readonly workspaceId: WorkspaceId
  readonly planId: BatchPlanId
  readonly error: string
  readonly at: string
}

export interface BatchCheckpointStartedEvent {
  readonly type: 'batch.checkpoint.started'
  readonly workspaceId: WorkspaceId
  readonly planId: BatchPlanId
  readonly skillRunId: SkillRunId
  readonly at: string
}

export interface BatchCheckpointCompletedEvent {
  readonly type: 'batch.checkpoint.completed'
  readonly workspaceId: WorkspaceId
  readonly planId: BatchPlanId
  readonly skillRunId: SkillRunId
  readonly at: string
}

export interface BatchCheckpointFailedEvent {
  readonly type: 'batch.checkpoint.failed'
  readonly workspaceId: WorkspaceId
  readonly planId: BatchPlanId
  readonly skillRunId: SkillRunId
  readonly error: string
  readonly at: string
}

/**
 * Reactor finished partitioning a synced source and is about to start dispatching per-unit skill runs sequentially.
 * `totalUnits` is the count of units in `new` plus `changed`.
 * Subscribers (Studio's banner) use it to render progress against a known total.
 * `passId` keys back into the `ReactorCycle` record for the rich Activity-page view.
 */
export interface ReactorDispatchedEvent {
  readonly type: 'reactor.dispatched'
  readonly workspaceId: WorkspaceId
  readonly passId: ReactorCycleId
  readonly sourceId: SourceId
  readonly totalUnits: number
  readonly at: string
}

/**
 * Reactor finished all per-unit dispatches plus the checkpoint pass for a given source. The full reactor pass is over,
 * Studio clears the banner. `checkpointRan` distinguishes the "0 changed units,
 * no checkpoint needed" case from the normal flow.
 */
export interface ReactorCompletedEvent {
  readonly type: 'reactor.completed'
  readonly workspaceId: WorkspaceId
  readonly passId: ReactorCycleId
  readonly sourceId: SourceId
  readonly totalUnits: number
  readonly checkpointRan: boolean
  readonly at: string
}

/**
 * Reactor refused to dispatch because the rolling 1h window already hit the workspace's `maxRunsPerHour`.
 * The triggering `source.synced` is acknowledged and dropped.
 * The operator's next manual sync (or another reactor pass after the window slides) will re-attempt.
 */
export interface ReactorThrottledEvent {
  readonly type: 'reactor.throttled'
  readonly workspaceId: WorkspaceId
  readonly passId: ReactorCycleId
  readonly sourceId: SourceId
  readonly limit: number
  readonly at: string
}

/**
 * Per-unit start signal. Studio's Activity page uses it to advance the highlighted row in the running pass's timeline.
 * The banner uses `processed`/`total` to render the "3/15" progress text.
 */
export interface ReactorUnitStartedEvent {
  readonly type: 'reactor.unit.started'
  readonly workspaceId: WorkspaceId
  readonly passId: ReactorCycleId
  readonly unitPath: string
  readonly skillRunId: SkillRunId
  readonly processed: number
  readonly total: number
  readonly at: string
}

/**
 * Per-unit completion signal. `status` carries whether the dispatched skill exited cleanly.
 * A failure does NOT abort the loop, the next unit still starts.
 */
export interface ReactorUnitCompletedEvent {
  readonly type: 'reactor.unit.completed'
  readonly workspaceId: WorkspaceId
  readonly passId: ReactorCycleId
  readonly unitPath: string
  readonly status: 'success' | 'failure'
  readonly processed: number
  readonly total: number
  readonly at: string
}

/**
 * Checkpoint skill is about to start (only fires when at least one per-unit dispatch succeeded,
 * and the ontology declares a checkpoint binding).
 */
export interface ReactorCheckpointStartedEvent {
  readonly type: 'reactor.checkpoint.started'
  readonly workspaceId: WorkspaceId
  readonly passId: ReactorCycleId
  readonly skillId: SkillId
  readonly skillRunId: SkillRunId
  readonly at: string
}

/**
 * Checkpoint skill finished.
 * `status === 'skipped'` means the pass decided not to run the checkpoint (no successful per-unit,
 * or no checkpoint binding), kept here so the Activity timeline always has a terminal entry for the checkpoint row.
 */
export interface ReactorCheckpointCompletedEvent {
  readonly type: 'reactor.checkpoint.completed'
  readonly workspaceId: WorkspaceId
  readonly passId: ReactorCycleId
  readonly status: 'success' | 'failure' | 'skipped'
  readonly at: string
}

export type WorkspaceEventType = WorkspaceEvent['type']
