import { T0 as isoTimestamp } from '@braidhq/test-utils'
import { describe, expect, it } from 'vitest'

import { Decision, DecisionAction, DecisionActor, DecisionFilter } from '../src/index.js'

describe('DecisionAction', () => {
  it('enumerates every HITL transition we record', () => {
    expect(DecisionAction.options).toEqual([
      'applyProposal',
      'rejectProposal',
      'answerClarifyTicket',
      'applyClarifyTicket',
      'skipClarifyTicket',
      'manualEdit',
    ])
  })
})

describe('DecisionActor', () => {
  it('accepts user id', () => {
    expect(DecisionActor.parse('u-1')).toBe('u-1')
  })
  it('accepts literal "system"', () => {
    expect(DecisionActor.parse('system')).toBe('system')
  })
})

describe('Decision', () => {
  it('parses applyProposal decision', () => {
    const decision = Decision.parse({
      id: 'd-1',
      workspaceId: 'w-1',
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
      workspaceId: 'w-1',
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
      workspaceId: 'w-1',
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
        workspaceId: 'w-1',
        timestamp: isoTimestamp,
        action: 'mystery',
        by: 'u-1',
        references: {},
      }).success,
    ).toBe(false)
  })

  it('rejects decision without workspaceId', () => {
    expect(
      Decision.safeParse({
        id: 'd-1',
        timestamp: isoTimestamp,
        action: 'applyProposal',
        by: 'u-1',
        references: {},
      }).success,
    ).toBe(false)
  })
})

describe('DecisionFilter', () => {
  it('all fields optional', () => {
    expect(DecisionFilter.parse({})).toEqual({})
  })
  it('accepts workspaceId / actions / limit / offset', () => {
    const filter = DecisionFilter.parse({
      workspaceId: 'w-1',
      actions: ['applyProposal'],
      limit: 10,
      offset: 0,
    })
    expect(filter.workspaceId).toBe('w-1')
  })
})
