import type {
  AnswerId,
  ClarifyTicketId,
  DecisionId,
  EdgeId,
  NodeId,
  ProposalId,
  QuestionId,
  SkillRunId,
} from '@telos/schema'

export function newNodeId(): NodeId {
  return crypto.randomUUID() as NodeId
}

export function newEdgeId(): EdgeId {
  return crypto.randomUUID() as EdgeId
}

export function newProposalId(): ProposalId {
  return crypto.randomUUID() as ProposalId
}

export function newClarifyTicketId(): ClarifyTicketId {
  return crypto.randomUUID() as ClarifyTicketId
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
