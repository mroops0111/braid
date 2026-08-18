import type { GraphNode, NodeTypeId } from '@braidhq/schema'
import type { GraphFilters } from '../../../src/components/graph/GraphNavigator'
import { describe, expect, it } from 'vitest'
import { matchesSearch, revealNode } from '../../../src/components/graph/revealFilters'

function node(id: string, type: string, name = 'Pending Approval', description?: string): GraphNode {
  return {
    id: id as GraphNode['id'],
    name,
    type: type as NodeTypeId,
    status: 'draft',
    metadata: { sourceReferences: [] },
    ...(description === undefined ? {} : { description }),
  }
}

function filtersOf(overrides: Partial<GraphFilters> = {}): GraphFilters {
  return { search: '', types: ['aggregate'] as NodeTypeId[], orphansOnly: false, ...overrides }
}

const TARGET = node('agg.pendingApproval', 'aggregate')

describe('matchesSearch', () => {
  it('matches everything on an empty query', () => {
    expect(matchesSearch('', TARGET)).toBe(true)
  })
  it('matches the name case-insensitively', () => {
    expect(matchesSearch('PENDING', TARGET)).toBe(true)
  })
  it('matches the description', () => {
    expect(matchesSearch('held back', node('a', 'aggregate', 'A', 'Held back until yes'))).toBe(true)
  })
  it('rejects a miss', () => {
    expect(matchesSearch('cart', TARGET)).toBe(false)
  })
})

describe('revealNode', () => {
  it('returns the same filter when nothing hides the target', () => {
    const filters = filtersOf()
    expect(revealNode(filters, { node: TARGET, isOrphan: false, neighbourTypes: [] })).toBe(filters)
  })

  it('adds the target type to the whitelist', () => {
    const revealed = revealNode(filtersOf({ types: ['boundedContext'] as NodeTypeId[] }), {
      node: node('rule.approvalExpiry', 'rule'),
      isOrphan: false,
      neighbourTypes: [],
    })
    expect(revealed.types).toEqual(['boundedContext', 'rule'])
  })

  it('keeps the reader\'s other type choices', () => {
    const revealed = revealNode(filtersOf({ types: ['boundedContext', 'aggregate'] as NodeTypeId[] }), {
      node: node('rule.approvalExpiry', 'rule'),
      isOrphan: false,
      neighbourTypes: [],
    })
    expect(revealed.types).toContain('boundedContext')
    expect(revealed.types).toContain('aggregate')
  })

  it('adds neighbour types so the focused view renders whole', () => {
    const revealed = revealNode(filtersOf({ types: [] }), {
      node: TARGET,
      isOrphan: false,
      neighbourTypes: ['rule', 'command'] as NodeTypeId[],
    })
    expect(revealed.types).toEqual(['aggregate', 'rule', 'command'])
  })

  it('adds each missing type once', () => {
    const revealed = revealNode(filtersOf({ types: [] }), {
      node: TARGET,
      isOrphan: false,
      neighbourTypes: ['rule', 'rule', 'aggregate'] as NodeTypeId[],
    })
    expect(revealed.types).toEqual(['aggregate', 'rule'])
  })

  it('clears a search that hides the target', () => {
    const revealed = revealNode(filtersOf({ search: 'cart' }), {
      node: TARGET,
      isOrphan: false,
      neighbourTypes: [],
    })
    expect(revealed.search).toBe('')
  })

  it('keeps a search the target already matches', () => {
    const revealed = revealNode(filtersOf({ search: 'pending', types: [] }), {
      node: TARGET,
      isOrphan: false,
      neighbourTypes: [],
    })
    expect(revealed.search).toBe('pending')
  })

  it('clears orphans-only when the target is not an orphan', () => {
    const revealed = revealNode(filtersOf({ orphansOnly: true }), {
      node: TARGET,
      isOrphan: false,
      neighbourTypes: [],
    })
    expect(revealed.orphansOnly).toBe(false)
  })

  it('keeps orphans-only when the target is an orphan', () => {
    const filters = filtersOf({ orphansOnly: true })
    expect(revealNode(filters, { node: TARGET, isOrphan: true, neighbourTypes: [] })).toBe(filters)
  })
})
