import { describe, expect, it } from 'vitest'
import {
  Clarification,
  ClarificationAmbiguityType,
  ClarificationCandidate,
  ClarificationCreate,
  ClarificationFilter,
  ClarificationOrigin,
  ClarificationStatus,
} from '../src/index.js'

describe('ClarificationStatus', () => {
  it('has 4 states', () => {
    expect(ClarificationStatus.options).toEqual(['pending', 'answered', 'applied', 'skipped'])
  })
})

describe('ClarificationCandidate', () => {
  it('parses with empty references and operations', () => {
    const candidate = ClarificationCandidate.parse({
      id: 'cc-1',
      description: 'voidTask and cancelTask are the same command',
    })
    expect(candidate.sourceReferences).toEqual([])
    expect(candidate.proposedOperations).toEqual([])
  })

  it('parses with proposed operations', () => {
    const candidate = ClarificationCandidate.parse({
      id: 'cc-1',
      description: 'merge them',
      proposedOperations: [{ operation: 'removeNode', nodeId: 'n-1' }],
    })
    expect(candidate.proposedOperations).toHaveLength(1)
  })
})

describe('Clarification', () => {
  it('parses pending ticket with candidates', () => {
    const ticket = Clarification.parse({
      id: 'ct-1',
      workspaceId: 'w-1',
      question: 'voidTask vs cancelTask: same command?',
      candidates: [
        { id: 'cc-1', description: 'yes, merge' },
        { id: 'cc-2', description: 'no, distinct' },
      ],
      status: 'pending',
      owner: 'system',
      origin: 'skill',
    })
    expect(ticket.candidates).toHaveLength(2)
  })

  it('rejects empty question', () => {
    expect(
      Clarification.safeParse({
        id: 'ct-1',
        workspaceId: 'w-1',
        question: '',
        candidates: [],
        status: 'pending',
      }).success,
    ).toBe(false)
  })

  it('accepts answered ticket with selection + resolution', () => {
    const ticket = Clarification.parse({
      id: 'ct-1',
      workspaceId: 'w-1',
      question: 'x?',
      candidates: [{ id: 'cc-1', description: 'a' }],
      status: 'answered',
      owner: 'system',
      origin: 'skill',
      answeredBy: 'u-1',
      selectedCandidateId: 'cc-1',
      resolution: [{ operation: 'removeNode', nodeId: 'n-1' }],
    })
    expect(ticket.selectedCandidateId).toBe('cc-1')
  })

  it('accepts externalReferences (v2 forward-compat)', () => {
    const ticket = Clarification.parse({
      id: 'ct-1',
      workspaceId: 'w-1',
      question: 'x?',
      candidates: [],
      status: 'pending',
      owner: 'system',
      origin: 'skill',
      externalReferences: [{ kind: 'redmine', url: 'https://redmine.example.com/issues/1' }],
    })
    expect(ticket.externalReferences?.[0]?.kind).toBe('redmine')
  })
})

describe('ClarificationFilter', () => {
  it('all fields optional', () => {
    expect(ClarificationFilter.parse({})).toEqual({})
  })
  it('accepts status filter', () => {
    expect(ClarificationFilter.parse({ statuses: ['pending'] }).statuses).toEqual(['pending'])
  })
})

describe('ClarificationOrigin', () => {
  it('is skill or human', () => {
    expect(ClarificationOrigin.options).toEqual(['skill', 'human'])
  })
})

describe('ClarificationAmbiguityType', () => {
  it('has the four human-filed ambiguity kinds', () => {
    expect(ClarificationAmbiguityType.options).toEqual(['gap', 'contradiction', 'ambiguous', 'assumption'])
  })
})

describe('ClarificationCandidate single-line rule', () => {
  it('rejects a multi-line description', () => {
    expect(ClarificationCandidate.safeParse({ id: 'cc-1', description: 'line one\nline two' }).success).toBe(false)
  })
})

describe('ClarificationCreate', () => {
  it('omits server-assigned fields and leaves origin optional', () => {
    const created = ClarificationCreate.parse({
      workspaceId: 'w-1',
      question: 'voidTask vs cancelTask?',
      candidates: [],
    })
    expect(created.origin).toBeUndefined()
  })
  it('accepts a human-filed ticket with context and ambiguityType', () => {
    const created = ClarificationCreate.parse({
      workspaceId: 'w-1',
      question: 'is the cap 50 or 99?',
      candidates: [],
      origin: 'human',
      context: 'PRD says 50, code says 99',
      ambiguityType: 'contradiction',
    })
    expect(created.ambiguityType).toBe('contradiction')
  })
})
