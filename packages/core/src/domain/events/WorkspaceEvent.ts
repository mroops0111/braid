import type {
  ClarifyTicketId,
  ProposalId,
  SkillRunId,
  SourceId,
  WorkspaceId,
} from '@braidhq/schema'

/**
 * Workspace-scoped runtime notifications. Pure transport for the Studio's
 * `useWorkspaceEvents` hook to invalidate react-query caches the moment a
 * server mutation happens. NOT persisted. NOT replayable. Server restart
 * drops anything in flight; clients re-fetch on reconnect.
 *
 * Anything you'd otherwise have to "click refresh" for should fire here.
 * Keep payloads small: only the identifiers a subscriber needs to know
 * which query keys to invalidate. The fresh value lives behind the
 * existing list / detail endpoints; events are signals, not deliveries.
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
  readonly proposalId: ProposalId
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

export type WorkspaceEventType = WorkspaceEvent['type']
