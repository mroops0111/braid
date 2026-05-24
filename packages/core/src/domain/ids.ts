import type {
  AnswerId,
  ClarifyTicketId,
  DecisionId,
  DriftIssueId,
  EdgeId,
  NodeId,
  ProposalId,
  QuestionId,
  SkillRunId,
  Timestamp,
} from '@braidhq/schema'

export function newNodeId(): NodeId {
  return crypto.randomUUID() as NodeId
}

export function newEdgeId(): EdgeId {
  return crypto.randomUUID() as EdgeId
}

/**
 * HITL artifact ids are date-prefixed (`p-YYYY-MM-DD-{short}`,
 * `ct-YYYY-MM-DD-{short}`) so they sort chronologically, fit in narrow
 * UI surfaces without truncation, and match the documented format in
 * `skills/shared/artifact-formats.md`. The `now` argument is the Clock
 * reading at creation time. Random suffix is 8 hex chars of a UUID,
 * which is enough to avoid same-day collisions for any plausible
 * proposal volume.
 */
export function newProposalId(now: Timestamp): ProposalId {
  return `p-${dateOf(now)}-${shortRandom()}` as ProposalId
}

export function newClarifyTicketId(now: Timestamp): ClarifyTicketId {
  return `ct-${dateOf(now)}-${shortRandom()}` as ClarifyTicketId
}

function dateOf(iso: Timestamp): string {
  return iso.slice(0, 10)
}

function shortRandom(): string {
  return crypto.randomUUID().slice(0, 8)
}

export function newDecisionId(): DecisionId {
  return crypto.randomUUID() as DecisionId
}

export function newQuestionId(): QuestionId {
  return crypto.randomUUID() as QuestionId
}

export function newAnswerId(): AnswerId {
  return crypto.randomUUID() as AnswerId
}

export function newSkillRunId(): SkillRunId {
  return crypto.randomUUID() as SkillRunId
}

export function newDriftIssueId(): DriftIssueId {
  return crypto.randomUUID() as DriftIssueId
}
