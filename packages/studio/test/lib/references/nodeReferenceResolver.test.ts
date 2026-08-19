import type { GraphNode, NodeId } from '@braidhq/schema'
import { NODE_REFERENCE_KIND } from '@braidhq/schema'
import { describe, expect, it, vi } from 'vitest'
import { createNodeReferenceResolver, identifierWords } from '../../../src/lib/references/nodeReferenceResolver'

function node(id: string, name: string, type: string, description?: string): GraphNode {
  return {
    id: id as NodeId,
    name,
    type: type as GraphNode['type'],
    status: 'draft',
    metadata: { sourceReferences: [] },
    ...(description === undefined ? {} : { description }),
  }
}

const NODES = [
  node('ctx.signTask', '簽署任務 (Sign Task)', 'bounded-context', 'Owns the signing flow.\n\nSecond paragraph.'),
  node('agg.cart', 'Shopping Cart', 'aggregate'),
  node('cmd.place_order', '下訂單', 'command'),
]

function resolverOf(onOpen?: (nodeId: NodeId) => void) {
  const nodesById = new Map(NODES.map(entry => [entry.id as string, entry]))
  return createNodeReferenceResolver({ nodesById, ...(onOpen ? { onOpen } : {}) })
}

describe('createNodeReferenceResolver', () => {
  it('claims the node kind', () => {
    expect(resolverOf().kind).toBe(NODE_REFERENCE_KIND)
  })

  it('resolves a known id to its title, type, and first paragraph', () => {
    const resolved = resolverOf().resolve('ctx.signTask')
    expect(resolved?.title).toBe('簽署任務 (Sign Task)')
    expect(resolved?.badge).toBe('bounded-context')
    expect(resolved?.description).toBe('Owns the signing flow.')
  })

  it('returns null for an unknown id', () => {
    expect(resolverOf().resolve('ctx.missing')).toBeNull()
  })

  it('omits open when no navigation is wired', () => {
    expect(resolverOf().resolve('agg.cart')?.open).toBeUndefined()
  })

  it('opens the node it resolved', () => {
    const onOpen = vi.fn()
    resolverOf(onOpen).resolve('agg.cart')?.open?.()
    expect(onOpen).toHaveBeenCalledWith('agg.cart')
  })
})

describe('node search', () => {
  function idsFor(query: string): string[] {
    return [...resolverOf().search(query)]
      .sort((left, right) => right.score - left.score)
      .map(candidate => candidate.reference.id)
  }

  it('browses everything on an empty query', () => {
    expect(idsFor('')).toHaveLength(NODES.length)
  })

  it('matches an id prefix', () => {
    expect(idsFor('ctx')).toEqual(['ctx.signTask'])
  })

  it('matches a CJK name with no tokenizer', () => {
    expect(idsFor('簽署')).toEqual(['ctx.signTask'])
    expect(idsFor('下訂')).toEqual(['cmd.place_order'])
  })

  it('matches a camel-case word inside an id', () => {
    expect(idsFor('task')).toEqual(['ctx.signTask'])
  })

  it('matches a type so a query browses one kind of node', () => {
    expect(idsFor('aggregate')).toEqual(['agg.cart'])
  })

  it('ranks an exact id above a mere containment', () => {
    const scores = resolverOf().search('agg.cart')
    expect(scores[0]?.reference.id).toBe('agg.cart')
  })

  it('returns nothing when nothing matches', () => {
    expect(idsFor('zzz')).toEqual([])
  })

  it('truncates a long first paragraph', () => {
    const long = node('ctx.long', 'Long', 'bounded-context', 'x'.repeat(400))
    const resolver = createNodeReferenceResolver({ nodesById: new Map([['ctx.long', long]]) })
    expect(resolver.resolve('ctx.long')?.description).toHaveLength(240)
  })
})

describe('identifierWords', () => {
  it('splits on separators and camel humps', () => {
    expect(identifierWords('ctx.signTask')).toEqual(['ctx', 'sign', 'task'])
    expect(identifierWords('cmd.place_order')).toEqual(['cmd', 'place', 'order'])
  })
  it('leaves a CJK id whole', () => {
    expect(identifierWords('簽署任務')).toEqual(['簽署任務'])
  })
})
