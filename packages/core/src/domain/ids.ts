import type {
  BatchPlanId,
  BatchUnitId,
  ClarifyCandidateId,
  ClarifyTicketId,
  DriftIssueId,
  EdgeId,
  NodeId,
  ProposalId,
  ReactorCycleId,
  SkillRunId,
  UserId,
} from '@braidhq/schema'

// Every id is the type name in kebab-case then a 12 hex random suffix,
// for example `clarify-ticket-3f9a2b7c1d4e`. The name keeps logs and urls readable,
// the random is 48 bit, collision-safe far past this project's volume.
// No time in the id, entities carry their own timestamp,
// every listing sorts on that field, never on the id string.
function mint<T extends string>(name: string): T {
  return `${name}-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}` as T
}

export const newProposalId = (): ProposalId => mint('proposal')
export const newClarifyTicketId = (): ClarifyTicketId => mint('clarify-ticket')
export const newBatchPlanId = (): BatchPlanId => mint('batch-plan')
export const newReactorCycleId = (): ReactorCycleId => mint('reactor-cycle')
export const newSkillRunId = (): SkillRunId => mint('skill-run')
export const newClarifyCandidateId = (): ClarifyCandidateId => mint('clarify-candidate')
export const newBatchUnitId = (): BatchUnitId => mint('batch-unit')
export const newDriftIssueId = (): DriftIssueId => mint('drift-issue')
export const newUserId = (): UserId => mint('user')
export const newNodeId = (): NodeId => mint('node')
export const newEdgeId = (): EdgeId => mint('edge')
