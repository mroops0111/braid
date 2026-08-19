import type { ReferenceKind } from '@braidhq/schema'
import type { ReferenceCandidate, ReferenceResolver } from '../../../src/lib/references/ReferenceResolver'
import { ReferenceKind as ReferenceKindSchema } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { createReferenceRegistry } from '../../../src/lib/references/referenceRegistry'

const NODE = ReferenceKindSchema.parse('node')
const SOURCE_UNIT = ReferenceKindSchema.parse('source-unit')

function fakeResolver(kind: ReferenceKind, entries: ReadonlyArray<{ id: string, score: number }>): ReferenceResolver {
  const candidates: ReferenceCandidate[] = entries.map(entry => ({
    reference: { kind, id: entry.id },
    title: entry.id.toUpperCase(),
    score: entry.score,
  }))
  return {
    kind,
    resolve: id => candidates.find(candidate => candidate.reference.id === id) ?? null,
    search: () => candidates,
    // A plain string is a valid ReactNode, which keeps this test render-free.
    renderDetail: id => `detail for ${id}`,
  }
}

const nodeResolver = fakeResolver(NODE, [{ id: 'agg.cart', score: 50 }, { id: 'ctx.signTask', score: 90 }])
const sourceResolver = fakeResolver(SOURCE_UNIT, [{ id: 'intents/checkout.md', score: 70 }])

describe('createReferenceRegistry', () => {
  it('routes a resolution to the resolver owning the kind', () => {
    const registry = createReferenceRegistry([nodeResolver, sourceResolver])
    expect(registry.resolve({ kind: NODE, id: 'agg.cart' })?.title).toBe('AGG.CART')
    expect(registry.resolve({ kind: SOURCE_UNIT, id: 'intents/checkout.md' })?.title).toBe('INTENTS/CHECKOUT.MD')
  })

  it('returns null for a kind no resolver claims', () => {
    const registry = createReferenceRegistry([nodeResolver])
    expect(registry.resolve({ kind: SOURCE_UNIT, id: 'intents/checkout.md' })).toBeNull()
  })

  it('routes a detail body to the resolver owning the kind', () => {
    const registry = createReferenceRegistry([nodeResolver, sourceResolver])
    expect(registry.renderDetail({ kind: NODE, id: 'agg.cart' })).toBe('detail for agg.cart')
  })

  it('returns no detail body for a kind no resolver claims', () => {
    const registry = createReferenceRegistry([nodeResolver])
    expect(registry.renderDetail({ kind: SOURCE_UNIT, id: 'intents/checkout.md' })).toBeNull()
  })

  it('returns no detail body when the resolver ships none', () => {
    const { renderDetail: _omitted, ...bare } = nodeResolver
    const registry = createReferenceRegistry([bare])
    expect(registry.renderDetail({ kind: NODE, id: 'agg.cart' })).toBeNull()
  })

  it('merges every kind into one ranked menu', () => {
    const registry = createReferenceRegistry([nodeResolver, sourceResolver])
    expect(registry.search('').map(candidate => candidate.reference.id)).toEqual([
      'ctx.signTask',
      'intents/checkout.md',
      'agg.cart',
    ])
  })

  it('scopes the search to one kind when asked', () => {
    const registry = createReferenceRegistry([nodeResolver, sourceResolver])
    expect(registry.search('', { kind: SOURCE_UNIT })).toHaveLength(1)
  })

  it('returns nothing when the scoped kind has no resolver', () => {
    const registry = createReferenceRegistry([nodeResolver])
    expect(registry.search('', { kind: SOURCE_UNIT })).toEqual([])
  })

  it('caps the menu at the requested limit', () => {
    const registry = createReferenceRegistry([nodeResolver, sourceResolver])
    expect(registry.search('', { limit: 2 })).toHaveLength(2)
  })
})
