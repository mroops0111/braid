import { describe, expect, it } from 'vitest'
import { Decision, DecisionAction, DecisionActor } from '../src/index.js'

const isoTimestamp = '2026-05-09T12:00:00+08:00'

describe('decisionAction', () => {
  it('has 5 actions', () => {
    expect(DecisionAction.options).toEqual([
      'applyProposal',
      'rejectProposal',
      'answerClarifyTicket',
      'skipClarifyTicket',
      'manualEdit',
    ])
  })
})

describe('decisionActor', () => {
  it('accepts user id', () => {
    expect(DecisionActor.parse('u-1')).toBe('u-1')
  })
  it('accepts literal "system"', () => {
    expect(DecisionActor.parse('system')).toBe('system')
  })
})

describe('decision', () => {
  it('parses applyProposal decision', () => {
    const decision = Decision.parse({
      id: 'd-1',
      timestamp: isoTimestamp,
      action: 'applyProposal',
      by: 'u-1',
      references: { proposalId: 'p-1' },
    })
    expect(decision.action).toBe('applyProposal')
  })

  it('parses with optional rationale', () => {
    const decision = Decision.parse({
      id: 'd-1',
      timestamp: isoTimestamp,
      action: 'rejectProposal',
      by: 'u-1',
      rationale: 'Conflicts with existing aggregate boundary',
      references: { proposalId: 'p-1' },
    })
    expect(decision.rationale).toContain('Conflicts')
  })

  it('parses system-actor manual edit', () => {
    const decision = Decision.parse({
      id: 'd-1',
      timestamp: isoTimestamp,
      action: 'manualEdit',
      by: 'system',
      references: {},
    })
    expect(decision.by).toBe('system')
  })

  it('rejects unknown action', () => {
    expect(
      Decision.safeParse({
        id: 'd-1',
        timestamp: isoTimestamp,
        action: 'mystery',
        by: 'u-1',
        references: {},
      }).success,
    ).toBe(false)
  })
})
