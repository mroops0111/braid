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
  it('newNodeId returns a non-empty unique string', () => {
    const a = newNodeId()
    const b = newNodeId()
    expect(a).not.toBe(b)
    expect(typeof a).toBe('string')
    expect(a.length).toBeGreaterThan(0)
  })

  it('newEdgeId returns distinct ids', () => {
    const ids = [newEdgeId(), newEdgeId()]
    expect(new Set(ids).size).toBe(2)
  })

  it('mints a kebab-name-prefixed 12 hex id', () => {
    expect(newProposalId()).toMatch(/^proposal-[0-9a-f]{12}$/)
    expect(newClarifyTicketId()).toMatch(/^clarify-ticket-[0-9a-f]{12}$/)
    expect(newNodeId()).toMatch(/^node-[0-9a-f]{12}$/)
  })

  it('two ids of the same type do not collide', () => {
    expect(newProposalId()).not.toBe(newProposalId())
  })

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
})
