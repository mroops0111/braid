import type { EdgeId, NodeId, ProposalId, QuestionId } from '@telos/schema'

export function newNodeId(): NodeId {
  return crypto.randomUUID() as NodeId
}

export function newEdgeId(): EdgeId {
  return crypto.randomUUID() as EdgeId
}

export function newProposalId(): ProposalId {
  return crypto.randomUUID() as ProposalId
}

export function newQuestionId(): QuestionId {
  return crypto.randomUUID() as QuestionId
}
