import { describe, expect, it } from 'vitest'
import { DDD_EDGE_TYPES, DDD_NODE_TYPES, DDDEdgeType, DDDNodeType } from '../src/index.js'

describe('DDD node types', () => {
  it('lists 7 nodes: boundedContext / aggregate / command / query / event / rule / actor', () => {
    expect(DDD_NODE_TYPES).toEqual([
      'boundedContext',
      'aggregate',
      'command',
      'query',
      'event',
      'rule',
      'actor',
    ])
    expect(DDDNodeType.options).toHaveLength(7)
  })

  it('rejects types outside the declared set', () => {
    expect(DDDNodeType.safeParse('screen').success).toBe(false)
    expect(DDDNodeType.safeParse('metric').success).toBe(false)
  })

  it('accepts each declared type', () => {
    for (const nodeType of DDD_NODE_TYPES) {
      expect(DDDNodeType.parse(nodeType)).toBe(nodeType)
    }
  })
})

describe('DDD edge types', () => {
  it('lists 7 edges including performedBy for actor links', () => {
    expect(DDD_EDGE_TYPES).toEqual([
      'contains',
      'accepts',
      'emits',
      'triggers',
      'constrainedBy',
      'dependsOn',
      'performedBy',
    ])
    expect(DDDEdgeType.options).toHaveLength(7)
  })

  it('rejects edges tied to node types not yet shipped', () => {
    expect(DDDEdgeType.safeParse('usesScreen').success).toBe(false)
    expect(DDDEdgeType.safeParse('measures').success).toBe(false)
  })

  it('rejects non-DDD edges', () => {
    expect(DDDEdgeType.safeParse('extends').success).toBe(false)
    expect(DDDEdgeType.safeParse('crossCuts').success).toBe(false)
  })

  it('accepts each declared type', () => {
    for (const edgeType of DDD_EDGE_TYPES) {
      expect(DDDEdgeType.parse(edgeType)).toBe(edgeType)
    }
  })
})
