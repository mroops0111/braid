import type {
  AnswerId,
  BatchPlanId,
  ClarifyCandidateId,
  ClarifyTicketId,
  DecisionId,
  DriftIssueId,
  EdgeId,
  NodeId,
  PlanUnitId,
  ProposalId,
  QuestionId,
  SkillRunId,
  Timestamp,
  UserId,
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
 * `skills/shared/{proposal,clarify}-format.md`. The `now` argument is the Clock
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

/**
 * Candidate id for user-authored candidates appended via the answer
 * flow. Skill-emitted candidates use their own deterministic naming
 * (`cc-1`, `cc-merge`, …) since the skill mints them at extract time;
 * this minter is only for the "+ Add my own answer" path.
 */
export function newClarifyCandidateId(): ClarifyCandidateId {
  return `cc-${shortRandom()}` as ClarifyCandidateId
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

export function newBatchPlanId(now: Timestamp): BatchPlanId {
  return `bp-${dateOf(now)}-${shortRandom()}` as BatchPlanId
}

export function newPlanUnitId(): PlanUnitId {
  return `pu-${shortRandom()}` as PlanUnitId
}

/**
 * Opaque, prefix-tagged userId. Stable across renames: we may add an
 * `email` or `displayName` field on the User row later, but the id
 * itself never changes after creation, so artifacts that captured
 * `reviewedBy: usr-...` keep pointing at the same person.
 */
export function newUserId(): UserId {
  return `usr-${shortRandom()}` as UserId
}
