import { describe, expect, it } from 'vitest'
import { DDD_EDGE_TYPES, DDD_NODE_TYPES, DDDEdgeType, DDDNodeType } from '../src/index.js'

describe('DDD node types (core DDD only — no actor / screen / metric)', () => {
  it('lists 6 nodes: boundedContext / aggregate / command / query / event / rule', () => {
    expect(DDD_NODE_TYPES).toEqual([
      'boundedContext',
      'aggregate',
      'command',
      'query',
      'event',
      'rule',
    ])
    expect(DDDNodeType.options).toHaveLength(6)
  })

  it('rejects non-DDD types', () => {
    expect(DDDNodeType.safeParse('actor').success).toBe(false)
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
  it('lists 6 edges aligned with the 6 node types', () => {
    expect(DDD_EDGE_TYPES).toEqual([
      'contains',
      'accepts',
      'emits',
      'triggers',
      'constrainedBy',
      'dependsOn',
    ])
    expect(DDDEdgeType.options).toHaveLength(6)
  })

  it('rejects edges tied to dropped node types', () => {
    expect(DDDEdgeType.safeParse('performedBy').success).toBe(false)
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
