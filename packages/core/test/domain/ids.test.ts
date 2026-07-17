import { describe, expect, it } from 'vitest'
import {
  newBatchPlanId,
  newBatchUnitId,
  newClarifyCandidateId,
  newClarifyTicketId,
  newDriftIssueId,
  newEdgeId,
  newNodeId,
  newProposalId,
  newReactorCycleId,
  newSkillRunId,
  newUserId,
} from '../../src/index.js'

describe('id minters', () => {
  it('every minter stamps its own kebab name on a 12 hex suffix', () => {
    const cases: [string, string][] = [
      ['proposal', newProposalId()],
      ['clarify-ticket', newClarifyTicketId()],
      ['batch-plan', newBatchPlanId()],
      ['reactor-cycle', newReactorCycleId()],
      ['skill-run', newSkillRunId()],
      ['clarify-candidate', newClarifyCandidateId()],
      ['batch-unit', newBatchUnitId()],
      ['drift-issue', newDriftIssueId()],
      ['user', newUserId()],
      ['node', newNodeId()],
      ['edge', newEdgeId()],
    ]
    for (const [name, id] of cases)
      expect(id).toMatch(new RegExp(`^${name}-[0-9a-f]{12}$`))
  })

  it('mints a fresh id on each call', () => {
    expect(newProposalId()).not.toBe(newProposalId())
    expect(newNodeId()).not.toBe(newNodeId())
  })
})
