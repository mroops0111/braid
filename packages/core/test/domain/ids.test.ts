import { describe, expect, it } from 'vitest'
import { newEdgeId, newNodeId, newProposalId, newQuestionId } from '../../src/index.js'

describe('id minters', () => {
  it('newNodeId returns a non-empty unique string', () => {
    const a = newNodeId()
    const b = newNodeId()
    expect(a).not.toBe(b)
    expect(typeof a).toBe('string')
    expect(a.length).toBeGreaterThan(0)
  })

  it('newEdgeId, newProposalId, newQuestionId all return distinct uuids', () => {
    const ids = [newEdgeId(), newProposalId(), newQuestionId()]
    expect(new Set(ids).size).toBe(3)
  })
})
