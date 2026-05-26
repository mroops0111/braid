import { describe, expect, it } from 'vitest'
import { DDD_EDGE_TYPES, DDD_NODE_TYPES, DDDEdgeType, DDDNodeType } from '../src/index.js'

describe('DDD node types', () => {
  it('lists the 8 modelling primitives (Evans/Vernon core plus EventStorming actor and policy)', () => {
    expect(DDD_NODE_TYPES).toEqual([
      'boundedContext',
      'aggregate',
      'command',
      'query',
      'event',
      'rule',
      'actor',
      'policy',
    ])
    expect(DDDNodeType.options).toHaveLength(8)
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
  it('lists the 15 edges (8 tactical plus 7 Context Mapping)', () => {
    expect(DDD_EDGE_TYPES).toEqual([
      'contains',
      'accepts',
      'emits',
      'triggers',
      'enacts',
      'constrainedBy',
      'dependsOn',
      'performedBy',
      'partnership',
      'customerSupplier',
      'conformist',
      'sharedKernel',
      'anticorruptionLayer',
      'openHostService',
      'publishedLanguage',
    ])
    expect(DDDEdgeType.options).toHaveLength(15)
  })

  it('rejects edges tied to node types not in the DDD core', () => {
    expect(DDDEdgeType.safeParse('usesScreen').success).toBe(false)
    expect(DDDEdgeType.safeParse('measures').success).toBe(false)
  })

  it('rejects edges that are not part of canonical DDD modelling', () => {
    expect(DDDEdgeType.safeParse('extends').success).toBe(false)
    expect(DDDEdgeType.safeParse('crossCuts').success).toBe(false)
  })

  it('accepts each declared type', () => {
    for (const edgeType of DDD_EDGE_TYPES) {
      expect(DDDEdgeType.parse(edgeType)).toBe(edgeType)
    }
  })
})
